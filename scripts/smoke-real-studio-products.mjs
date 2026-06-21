import './lib/load-real-env.mjs';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function buildAiConfig() {
  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL'),
    embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
    ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'AGENTPLAN_TTS_SPEAKER', 'ARK_TTS_SPEAKER'),
  };
}

function hasDoubaoAgentPlanTtsConfig(aiConfig = {}) {
  return Boolean(
    envFirst('AGENTPLAN_TTS_ENDPOINT', 'DOUBAO_TTS_ENDPOINT')
    && envFirst('AGENTPLAN_TTS_RESOURCE_ID', 'DOUBAO_TTS_RESOURCE_ID')
    && (envFirst('AGENTPLAN_TTS_API_KEY', 'DOUBAO_TTS_API_KEY', 'ARK_AGENTPLAN_API_KEY') || aiConfig.apiKey)
    && (envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'ARK_TTS_SPEAKER') || aiConfig.ttsSpeaker)
  );
}

function summarizeAudioUrl(audioUrl) {
  if (!audioUrl || typeof audioUrl !== 'string') return { audioUrlPresent: false };
  return {
    audioUrlPresent: true,
    audioUrlType: audioUrl.startsWith('data:') ? 'data-url' : audioUrl.startsWith('/uploads/') ? 'local-upload' : 'url',
    audioUrlLength: audioUrl.length,
  };
}

function localUploadPath(audioUrl) {
  if (!audioUrl || typeof audioUrl !== 'string' || !audioUrl.startsWith('/uploads/')) return '';
  const relative = audioUrl.replace(/^\/+/, '').replace(/\//g, path.sep);
  return path.join(process.cwd(), 'public', relative);
}

function readAudioDurationSeconds(filePath) {
  if (!filePath) return undefined;
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const duration = Number(result.stdout.trim());
  return Number.isFinite(duration) ? duration : undefined;
}

function redactSecret(text, apiKey) {
  let redacted = String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[REDACTED]"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[REDACTED]"');
  const key = apiKey?.trim();
  if (key) redacted = redacted.split(key).join('[REDACTED]');
  return redacted.slice(0, 1000);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local port.'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + Number(process.env.REAL_STUDIO_STARTUP_TIMEOUT_MS || 30_000);
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Runtime server exited before health check completed with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok && body.ok === true) return body;
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for /api/health. Last error: ${lastError}`);
}

async function withTimeout(name, timeoutMs, task) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const value = await task(controller.signal);
    return {
      name,
      status: 'PASS',
      durationMs: Date.now() - startedAt,
      ...value,
    };
  } catch (error) {
    return {
      name,
      status: 'FAIL',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(origin, urlPath, payload, signal) {
  const response = await fetch(`${origin}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

async function pollPodcastJob(origin, taskId, signal) {
  const deadline = Date.now() + Number(process.env.REAL_STUDIO_PODCAST_POLL_TIMEOUT_MS || 180_000);
  let lastBody;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/ai/podcast?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
    const body = await response.json().catch(async () => ({
      error: await response.text().catch(() => 'Podcast status response was not JSON.'),
    }));
    lastBody = body;
    if (!response.ok) throw new Error(`podcast status failed: ${JSON.stringify(body)}`);
    if ((body.status === 'completed' || body.status === 'succeeded') && body.audioUrl) return body;
    if (body.status === 'failed') throw new Error(`podcast job failed: ${JSON.stringify(body)}`);
    await new Promise(resolve => setTimeout(resolve, Number(process.env.REAL_STUDIO_PODCAST_POLL_INTERVAL_MS || 2000)));
  }
  throw new Error(`podcast job timed out: ${JSON.stringify(lastBody)}`);
}

async function readSse(response) {
  if (!response.body) throw new Error('SSE response has no body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let citations = [];
  let retrieval;
  let citationAudit;
  const errors = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      for (const line of event.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed.content) content += parsed.content;
        if (parsed.citations) citations = parsed.citations;
        if (parsed.retrieval) retrieval = parsed.retrieval;
        if (parsed.citationAudit) citationAudit = parsed.citationAudit;
        if (parsed.error) errors.push(parsed.error);
      }
    }
  }

  return { content, citations, retrieval, citationAudit, errors };
}

async function uploadSource(origin, aiConfig, signal) {
  const text = [
    '灵笔工作室真实 Studio 产品 smoke 资料。',
    '第 1 页：目标是对齐 NotebookLM 核心能力，包括资料源可信、中央对话、右侧 Studio 产物、引用可追溯和失败降级可见。',
    '第 2 页：知识卡片、学术报告、播客脚本和 PPT 都必须复用同一份 grounded context，并返回 sourceId、chunkId、snippet、score 和 citationAudit。',
    '第 3 页：PPT-v2 是长任务，必须有阶段进度、超时、失败重试和用户可理解等待文案，不能让用户以为系统卡死。',
    '第 4 页：服务器部署需要 build/start/health/smoke、Linux 一键包、持久化目录、对象存储和真实模型配置。',
  ].join('\n');
  const formData = new FormData();
  formData.append('files', new Blob([text], { type: 'text/plain' }), 'real-studio-products.txt');
  formData.append('aiConfig', JSON.stringify(aiConfig));

  const response = await fetch(`${origin}/api/upload`, { method: 'POST', body: formData, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(`/api/upload failed: ${JSON.stringify(body)}`);
  const uploaded = body.results?.[0];
  if (!uploaded?.id) throw new Error(`/api/upload did not return source id: ${JSON.stringify(body)}`);
  return uploaded;
}

function normalizePaper(uploaded) {
  return {
    id: uploaded.id,
    title: uploaded.title,
    authors: uploaded.authors,
    year: uploaded.year,
    shortName: uploaded.shortName,
    abstract: uploaded.abstract,
    content: uploaded.content,
    rawContent: uploaded.rawContent,
    fileName: uploaded.fileName,
    fileType: uploaded.fileType,
  };
}

function summarizeRetrieval(body) {
  return {
    citationCount: Array.isArray(body?.citations) ? body.citations.length : 0,
    retrievalMode: body?.retrieval?.mode,
    retrievalDegraded: body?.retrieval?.degraded,
    retrievalReason: body?.retrieval?.reason,
    citationAuditStatus: body?.citationAudit?.status,
  };
}

function emitProgress(payload) {
  console.log(JSON.stringify({
    event: 'real-studio-progress',
    time: new Date().toISOString(),
    ...payload,
  }));
}

function summarizeResultForProgress(result) {
  const {
    paper,
    sample,
    error,
    ...rest
  } = result;
  return {
    ...rest,
    sampleLength: sample ? sample.length : undefined,
    sourceId: result.sourceId || paper?.id,
    title: paper?.title,
    error: error ? redactSecret(error, buildAiConfig().apiKey) : undefined,
  };
}

async function runStage(name, timeoutMs, task) {
  emitProgress({ stage: name, status: 'START', timeoutMs });
  const result = await withTimeout(name, timeoutMs, task);
  emitProgress({ stage: name, ...summarizeResultForProgress(result) });
  return result;
}

async function main() {
  const aiConfig = buildAiConfig();
  const missing = [
    aiConfig.apiBase ? '' : 'OPENAI_COMPAT_API_BASE or ARK_API_BASE',
    aiConfig.apiKey ? '' : 'OPENAI_COMPAT_API_KEY or ARK_API_KEY',
    aiConfig.model ? '' : 'OPENAI_COMPAT_MODEL or ARK_MODEL',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      realService: false,
      missing,
      results: [{
        name: 'real Studio products',
        status: 'SKIP',
        reason: 'Missing real OpenAI-compatible configuration.',
      }],
    }, null, 2));
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-real-studio-products-'));
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = path.resolve('.deploy/evidence');
  await mkdir(evidenceDir, { recursive: true });
  const evidenceArtifacts = {};
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const runtimeEnv = process.env.REAL_STUDIO_RUNTIME_ENV || 'production';
  const runtimeScript = runtimeEnv === 'development' ? 'scripts/dev.mjs' : 'scripts/start.mjs';
  const child = spawn(process.execPath, [runtimeScript], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_RUNTIME_ENV: runtimeEnv,
      NODE_ENV: runtimeEnv,
      FILE_STORAGE_ADAPTER: process.env.REAL_STUDIO_FILE_STORAGE_ADAPTER || process.env.FILE_STORAGE_ADAPTER || 'local',
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  const results = [];
  try {
    emitProgress({ stage: 'runtime startup', status: 'START', origin });
    const health = await waitForHealth(origin, child);
    emitProgress({
      stage: 'runtime startup',
      status: 'PASS',
      service: health.service,
      sourceStore: health.capabilities?.sourceStore,
    });

    const uploadResult = await runStage('upload -> persisted source/chunks', Number(process.env.REAL_STUDIO_UPLOAD_TIMEOUT_MS || 120_000), async signal => {
      const uploaded = await uploadSource(origin, aiConfig, signal);
      if (uploaded.ingestionStatus !== 'succeeded') throw new Error(`ingestionStatus=${uploaded.ingestionStatus}`);
      if (!(uploaded.ingestionChunkCount > 0)) throw new Error('ingestionChunkCount was not positive');
      return {
        sourceId: uploaded.id,
        ingestionStatus: uploaded.ingestionStatus,
        chunkCount: uploaded.ingestionChunkCount,
        paper: normalizePaper(uploaded),
      };
    });
    results.push(uploadResult);
    if (uploadResult.status !== 'PASS') throw new Error('Cannot continue Studio product checks without uploaded source.');
    const papers = [uploadResult.paper];

    results.push(await runStage('knowledge-cards real generation', Number(process.env.REAL_STUDIO_CARDS_TIMEOUT_MS || 120_000), async signal => {
      const { response, body } = await postJson(origin, '/api/ai/knowledge-cards', { papers, aiConfig }, signal);
      if (!response.ok) throw new Error(JSON.stringify(body));
      const artifactPath = path.join(evidenceDir, `real-studio-products-knowledge-cards-${runId}.json`);
      await writeFile(artifactPath, JSON.stringify({
        cards: body.cards || [],
        citations: body.citations || [],
        retrieval: body.retrieval,
        citationAudit: body.citationAudit,
      }, null, 2), 'utf8');
      evidenceArtifacts.knowledgeCards = artifactPath;
      return {
        statusCode: response.status,
        artifactPath,
        cardCount: Array.isArray(body.cards) ? body.cards.length : 0,
        firstTitle: body.cards?.[0]?.title,
        categories: Array.from(new Set((body.cards || []).map(card => card.category))).slice(0, 8),
        ...summarizeRetrieval(body),
      };
    }));

    results.push(await runStage('report real SSE generation', Number(process.env.REAL_STUDIO_REPORT_TIMEOUT_MS || 120_000), async signal => {
      const response = await fetch(`${origin}/api/ai/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          outline: '围绕 NotebookLM 对齐、右侧 Studio、长任务体验和部署交付生成一份验收报告',
          papers,
          aiConfig,
        }),
        signal,
      });
      const body = await readSse(response);
      if (!response.ok || body.errors.length > 0) throw new Error(JSON.stringify({ status: response.status, errors: body.errors }));
      if (body.content.trim().length === 0) throw new Error('empty report content');
      const artifactPath = path.join(evidenceDir, `real-studio-products-report-${runId}.md`);
      await writeFile(artifactPath, [
        body.content.trim(),
        '',
        '---',
        '',
        '```json',
        JSON.stringify({
          citations: body.citations || [],
          retrieval: body.retrieval,
          citationAudit: body.citationAudit,
        }, null, 2),
        '```',
        '',
      ].join('\n'), 'utf8');
      evidenceArtifacts.report = artifactPath;
      return {
        statusCode: response.status,
        artifactPath,
        contentLength: body.content.trim().length,
        sample: body.content.trim().slice(0, 100),
        ...summarizeRetrieval(body),
      };
    }));

    results.push(await runStage('podcast grounded context', Number(process.env.REAL_STUDIO_PODCAST_CONTEXT_TIMEOUT_MS || 30_000), async signal => {
      const { response, body } = await postJson(origin, '/api/ai/podcast', {
        content: '生成一段播客脚本，讨论灵笔工作室对齐 NotebookLM 的验收重点。',
        papers,
        aiConfig,
        debugRetrievalOnly: true,
      }, signal);
      if (!response.ok || body.success !== true) throw new Error(JSON.stringify(body));
      return {
        statusCode: response.status,
        promptContextLength: body.promptContextLength,
        ...summarizeRetrieval(body),
        audioGenerationStatus: hasDoubaoAgentPlanTtsConfig(aiConfig) ? 'ready_for_real_doubao_tts_task' : 'SKIP_DOUBAO_AGENTPLAN_TTS_CONFIG_MISSING',
      };
    }));

    if (!hasDoubaoAgentPlanTtsConfig(aiConfig)) {
      results.push({
        name: 'podcast real Doubao AgentPlan TTS audio generation',
        status: 'SKIP',
        reason: 'Missing AGENTPLAN_TTS_ENDPOINT, AGENTPLAN_TTS_RESOURCE_ID, AGENTPLAN_TTS_API_KEY/ARK_AGENTPLAN_API_KEY, or AGENTPLAN_TTS_SPEAKER.',
      });
      emitProgress({
        stage: 'podcast real Doubao AgentPlan TTS audio generation',
        status: 'SKIP',
        reason: 'Missing AGENTPLAN_TTS_ENDPOINT, AGENTPLAN_TTS_RESOURCE_ID, AGENTPLAN_TTS_API_KEY/ARK_AGENTPLAN_API_KEY, or AGENTPLAN_TTS_SPEAKER.',
      });
    } else {
      results.push(await runStage('podcast real Doubao AgentPlan TTS audio generation', Number(process.env.REAL_STUDIO_PODCAST_AUDIO_TIMEOUT_MS || 180_000), async signal => {
        const { response, body } = await postJson(origin, '/api/ai/podcast', {
          content: '请基于资料生成一段 60 秒内的双人播客开场，重点说明右侧 Studio、PPT、播客和知识卡片为什么要复用同一 grounded context。',
          title: '灵笔工作室 NotebookLM 对齐真实播客 smoke',
          papers,
          aiConfig,
        }, signal);
        if (!response.ok || body.success !== true) throw new Error(JSON.stringify(body));
        const completed = body.audioUrl ? body : await pollPodcastJob(origin, body.taskId, signal);
        if ((completed.status !== 'completed' && completed.status !== 'succeeded') || !completed.audioUrl) {
          throw new Error(`podcast did not complete with audioUrl: ${JSON.stringify({ status: completed.status, provider: completed.provider, taskId: completed.taskId })}`);
        }
        const localPath = localUploadPath(completed.audioUrl);
        const fileSize = localPath && existsSync(localPath) ? statSync(localPath).size : 0;
        const audioDurationSeconds = localPath ? readAudioDurationSeconds(localPath) : undefined;
        const minDurationSeconds = Number(process.env.REAL_STUDIO_PODCAST_MIN_DURATION_SECONDS || 5);
        if (localPath && (!(fileSize > 0) || !(typeof audioDurationSeconds === 'number') || audioDurationSeconds < minDurationSeconds)) {
          throw new Error(`podcast audio is not usable: ${JSON.stringify({
            audioUrl: completed.audioUrl,
            localPath,
            fileSize,
            audioDurationSeconds,
            minDurationSeconds,
          })}`);
        }
        const artifactPath = path.join(evidenceDir, `real-studio-products-podcast-job-${runId}.json`);
        await writeFile(artifactPath, JSON.stringify({
          taskId: completed.taskId,
          status: completed.status,
          provider: completed.provider,
          audioUrl: completed.audioUrl,
          segments: completed.segments || completed.job?.artifactMeta?.segments || [],
          dialoguePreview: completed.dialoguePreview || completed.job?.artifactMeta?.dialoguePreview || '',
          citations: completed.citations || [],
          retrieval: completed.retrieval,
          citationAudit: completed.citationAudit,
          job: completed.job,
        }, null, 2), 'utf8');
        evidenceArtifacts.podcast = artifactPath;
        return {
          statusCode: response.status,
          artifactPath,
          provider: completed.provider,
          podcastStatus: completed.status,
          jobStage: completed.job?.stage,
          jobProgress: completed.job?.progress,
          ...summarizeAudioUrl(completed.audioUrl),
          localPath: localPath || undefined,
          fileSize: localPath ? fileSize : undefined,
          audioDurationSeconds,
          minDurationSeconds,
          ...summarizeRetrieval(completed),
        };
      }));
    }

    if (process.env.REAL_STUDIO_INCLUDE_PPT === 'false') {
      results.push({
        name: 'ppt-v2 real PPTX generation',
        status: 'SKIP',
        reason: 'REAL_STUDIO_INCLUDE_PPT=false',
      });
      emitProgress({
        stage: 'ppt-v2 real PPTX generation',
        status: 'SKIP',
        reason: 'REAL_STUDIO_INCLUDE_PPT=false',
      });
    } else {
      results.push(await runStage('ppt-v2 real PPTX generation', Number(process.env.REAL_STUDIO_PPT_TIMEOUT_MS || 420_000), async signal => {
        const response = await fetch(`${origin}/api/ai/ppt-v2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            papers,
            duration: Number(process.env.REAL_STUDIO_PPT_DURATION_MIN || 5),
            audience: 'researchers',
            speakerNotes: false,
            aiConfig,
          }),
          signal,
        });
        const contentType = response.headers.get('content-type') || '';
        const observability = decodeURIComponent(response.headers.get('x-llm-observability') || '');
        if (!response.ok) {
          const errorBody = contentType.includes('application/json') ? await response.json() : await response.text();
          throw new Error(JSON.stringify(errorBody));
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 10_000) throw new Error(`PPTX response too small: ${buffer.length} bytes`);
        const artifactPath = path.join(evidenceDir, `real-studio-products-ppt-v2-${runId}.pptx`);
        await writeFile(artifactPath, buffer);
        evidenceArtifacts.pptV2 = artifactPath;
        const parsedObservability = observability ? JSON.parse(observability) : undefined;
        if (
          parsedObservability?.fallbacks > 0
          && process.env.REAL_STUDIO_ALLOW_DEGRADED_PPT !== 'true'
        ) {
          throw new Error(`PPT-v2 used fallback stages and cannot pass real product smoke: ${JSON.stringify({
            failedStages: parsedObservability.failedStages,
            fallbackStages: parsedObservability.fallbackStages,
          })}`);
        }
        return {
          statusCode: response.status,
          bytes: buffer.length,
          artifactPath,
          contentType,
          observability: parsedObservability,
        };
      }));
    }

    const failed = results.filter(result => result.status === 'FAIL');
    const summary = {
      ok: failed.length === 0,
      realService: true,
      origin,
      health: {
        service: health.service,
        sourceStore: health.capabilities?.sourceStore,
      },
      artifacts: evidenceArtifacts,
      results,
    };
    const summaryPath = path.join(evidenceDir, `real-studio-products-summary-${runId}.json`);
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(JSON.stringify({
      ...summary,
      summaryPath,
    }, null, 2));

    if (failed.length > 0) process.exitCode = 1;
  } catch (error) {
    const recentOutput = redactSecret(output.join('').slice(-3000), aiConfig.apiKey);
    console.log(JSON.stringify({
      ok: false,
      realService: true,
      origin,
      results,
      error: redactSecret(error instanceof Error ? error.message : String(error), aiConfig.apiKey),
      recentServerOutput: recentOutput,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    killProcessTree(child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
