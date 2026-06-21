import './lib/load-real-env.mjs';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
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
    ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'ARK_TTS_SPEAKER'),
  };
}

function redactSecret(text, apiKey) {
  let redacted = String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[REDACTED]"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[REDACTED]"');
  const key = apiKey?.trim();
  if (key) redacted = redacted.split(key).join('[REDACTED]');
  return redacted.slice(0, 2000);
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
  const deadline = Date.now() + Number(process.env.REAL_PPT_STARTUP_TIMEOUT_MS || 30_000);
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

async function uploadSource(origin, aiConfig, signal) {
  const text = [
    '灵笔工作室真实 PPT-v2 生成验收资料。',
    '第 1 页：产品目标是对齐 NotebookLM 核心能力，资料源可信、中央对话、右侧 Studio 产物、引用可追溯、失败降级可见。',
    '第 2 页：知识卡片、学术报告、播客脚本和 PPT 必须复用同一份 grounded context，并返回 sourceId、chunkId、snippet、score、citationAudit。',
    '第 3 页：PPT-v2 是长任务，必须有阶段进度、超时、失败重试和用户可理解等待文案。',
    '第 4 页：服务器部署需要 build/start/health/smoke、Linux 一键包、持久化目录、对象存储和真实模型配置。',
  ].join('\n');
  const formData = new FormData();
  formData.append('files', new Blob([text], { type: 'text/plain' }), 'real-ppt-v2-artifact.txt');
  formData.append('aiConfig', JSON.stringify(aiConfig));

  const response = await fetch(`${origin}/api/upload`, { method: 'POST', body: formData, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(`/api/upload failed: ${JSON.stringify(body)}`);
  const uploaded = body.results?.[0];
  if (!uploaded?.id) throw new Error(`/api/upload did not return source id: ${JSON.stringify(body)}`);
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
      status: 'SKIP',
      missing,
    }, null, 2));
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-real-ppt-v2-artifact-'));
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const outputDir = path.resolve(process.env.REAL_PPT_OUTPUT_DIR || '.deploy/evidence');
  const outputPath = path.join(outputDir, `real-ppt-v2-${new Date().toISOString().replace(/[:.]/g, '-')}.pptx`);
  const output = [];
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_RUNTIME_ENV: process.env.REAL_PPT_RUNTIME_ENV || 'production',
      NODE_ENV: process.env.REAL_PPT_RUNTIME_ENV || 'production',
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      FILE_STORAGE_ADAPTER: process.env.REAL_PPT_FILE_STORAGE_ADAPTER || process.env.FILE_STORAGE_ADAPTER || 'local',
      LOCAL_FILE_STORAGE_DIR: path.join(tempDir, 'uploads'),
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.on('data', chunk => output.push(chunk.toString()));
  child.stderr?.on('data', chunk => output.push(chunk.toString()));

  const startedAt = Date.now();
  try {
    const health = await waitForHealth(origin, child);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.REAL_PPT_TIMEOUT_MS || 420_000));
    try {
      const paper = await uploadSource(origin, aiConfig, controller.signal);
      const outlineDraft = [
        {
          id: 'opening',
          title: '资料工作台复刻目标',
          focus: '说明本次简报围绕资料工作台、可确认的大纲生成流程和真实验收证据展开。',
          sourceLabel: '汇报设置',
        },
        {
          id: 'rag-context',
          title: '资料源与引用链路',
          focus: '概括资料上传、chunk、embedding/zvec、grounded context、citationAudit 的核心闭环。',
          sourceLabel: paper.shortName || paper.title,
        },
        {
          id: 'studio-products',
          title: '右侧 Studio 产物闭环',
          focus: '说明知识卡片、报告、播客、PPT 复用同一检索上下文，并展示长任务阶段反馈。',
          sourceLabel: paper.shortName || paper.title,
        },
        {
          id: 'next-actions',
          title: '风险与下一步',
          focus: '总结真实 API、PPTX 质量、播客音频和前端可读性的剩余风险与下一轮任务。',
          sourceLabel: paper.shortName || paper.title,
        },
      ];
      const response = await fetch(`${origin}/api/ai/ppt-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          papers: [paper],
          duration: Number(process.env.REAL_PPT_DURATION_MIN || 5),
          audience: 'researchers',
          speakerNotes: false,
          aiConfig,
          outlineDraft,
        }),
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      const observabilityHeader = response.headers.get('x-llm-observability') || '';
      if (!response.ok) {
        const errorBody = contentType.includes('application/json') ? await response.json() : await response.text();
        throw new Error(JSON.stringify(errorBody));
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 10_000) throw new Error(`PPTX response too small: ${buffer.length} bytes`);
      const observability = observabilityHeader ? JSON.parse(decodeURIComponent(observabilityHeader)) : undefined;
      if (
        observability?.fallbacks > 0
        && process.env.REAL_PPT_ALLOW_DEGRADED !== 'true'
      ) {
        throw new Error(`PPT-v2 used fallback stages and cannot be saved as a passing real artifact: ${JSON.stringify({
          failedStages: observability.failedStages,
          fallbackStages: observability.fallbackStages,
        })}`);
      }
      await mkdir(outputDir, { recursive: true });
      await writeFile(outputPath, buffer);
      console.log(JSON.stringify({
        ok: true,
        realService: true,
        origin,
        outputPath,
        bytes: buffer.length,
        durationMs: Date.now() - startedAt,
        contentType,
        health: {
          service: health.service,
          sourceStore: health.capabilities?.sourceStore,
        },
        observability,
      }, null, 2));
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      realService: true,
      origin,
      outputPath,
      durationMs: Date.now() - startedAt,
      error: redactSecret(error instanceof Error ? error.message : String(error), aiConfig.apiKey),
      recentServerOutput: redactSecret(output.join('').slice(-3000), aiConfig.apiKey),
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
