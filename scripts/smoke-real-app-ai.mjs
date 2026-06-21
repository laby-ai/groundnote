import './lib/load-real-env.mjs';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
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
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + Number(process.env.REAL_APP_AI_STARTUP_TIMEOUT_MS || 30_000);
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

function buildAiConfig() {
  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL'),
    embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
  };
}

function redactSecret(text, apiKey) {
  let redacted = String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[REDACTED]"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[REDACTED]"');
  const key = apiKey?.trim();
  if (key) redacted = redacted.split(key).join('[REDACTED]');
  return redacted.slice(0, 800);
}

async function uploadSource(origin, aiConfig) {
  const text = [
    '灵笔工作室真实中央对话持久向量 smoke 资料。',
    '第 1 页：NotebookLM-like 工作台必须先上传资料、完成 ingestion、生成 embedding，并写入持久化 zvec 索引。',
    '第 2 页：中央对话必须优先使用 persisted-vector 检索，返回 sourceId、chunkId、snippet、score 和 citationAudit。',
    '第 3 页：如果缺少 embedding 或索引，系统必须明确展示降级原因，不能把 fallback 当成真实通过。',
  ].join('\n');
  const formData = new FormData();
  formData.append('files', new Blob([text], { type: 'text/plain' }), 'real-persisted-chat.txt');
  formData.append('aiConfig', JSON.stringify(aiConfig));

  const response = await fetch(`${origin}/api/upload`, { method: 'POST', body: formData });
  const body = await response.json();
  if (!response.ok) throw new Error(`/api/upload failed: ${JSON.stringify(body)}`);
  const uploaded = body.results?.[0];
  if (!uploaded?.id) throw new Error(`/api/upload did not return source id: ${JSON.stringify(body)}`);
  if (uploaded.ingestionStatus !== 'succeeded') throw new Error(`ingestionStatus=${uploaded.ingestionStatus}`);
  if (!(uploaded.ingestionChunkCount > 0)) throw new Error('ingestionChunkCount was not positive');
  if (uploaded.vectorIndex?.status !== 'succeeded') {
    throw new Error(`vector index did not succeed: ${JSON.stringify(uploaded.vectorIndex)}`);
  }
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

async function main() {
  const aiConfig = buildAiConfig();
  const missing = [
    aiConfig.apiBase ? '' : 'OPENAI_COMPAT_API_BASE or ARK_API_BASE',
    aiConfig.apiKey ? '' : 'OPENAI_COMPAT_API_KEY or ARK_API_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      realService: false,
      checked: ['real app AI smoke env contract'],
      missing,
    }, null, 2));
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-real-app-ai-'));
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_RUNTIME_ENV: process.env.REAL_APP_AI_RUNTIME_ENV || 'production',
      NODE_ENV: process.env.REAL_APP_AI_RUNTIME_ENV || 'production',
      FILE_STORAGE_ADAPTER: process.env.REAL_APP_AI_FILE_STORAGE_ADAPTER || process.env.FILE_STORAGE_ADAPTER || 'local',
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      AI_TEST_CONFIG_TEXT_TIMEOUT_MS: process.env.AI_TEST_CONFIG_TEXT_TIMEOUT_MS || '45000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  try {
    await waitForHealth(origin, child);

    const testConfigResponse = await fetch(`${origin}/api/ai/test-config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aiConfig }),
    });
    const testConfig = await testConfigResponse.json();
    if (!testConfigResponse.ok || testConfig.ok !== true) {
      throw new Error(`test-config failed: ${JSON.stringify(testConfig)}`);
    }

    const uploaded = await uploadSource(origin, aiConfig);
    const sourceDetailResponse = await fetch(`${origin}/api/ingestion/sources?id=${encodeURIComponent(uploaded.id)}`);
    const sourceDetail = await sourceDetailResponse.json();
    if (!sourceDetailResponse.ok || sourceDetail.source?.id !== uploaded.id) {
      throw new Error(`/api/ingestion/sources?id failed: ${JSON.stringify(sourceDetail)}`);
    }

    const chatResponse = await fetch(`${origin}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: '请基于资料回答：中央对话为什么必须优先使用持久化向量索引？请使用引用标记。',
        maxTokens: Number(process.env.REAL_APP_AI_CHAT_MAX_TOKENS || 120),
        aiConfig,
        papers: [normalizePaper(uploaded)],
      }),
    });
    const chat = await readSse(chatResponse);
    if (!chatResponse.ok || chat.errors.length > 0 || chat.content.trim().length === 0) {
      throw new Error(`chat failed: ${JSON.stringify({ status: chatResponse.status, errors: chat.errors })}`);
    }
    if (chat.retrieval?.mode !== 'persisted-vector' || chat.retrieval?.degraded !== false) {
      throw new Error(`chat did not use persisted-vector retrieval: ${JSON.stringify(chat.retrieval)}`);
    }
    if (chat.citations.length === 0 || chat.citations[0]?.sourceId !== uploaded.id || !chat.citations[0]?.chunkId) {
      throw new Error(`chat citation did not point to uploaded persisted source: ${JSON.stringify(chat.citations)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      realService: true,
      origin,
      checked: [
        '/api/health production runtime',
        '/api/ai/test-config text model',
        '/api/ai/test-config vision model when configured',
        '/api/ai/test-config embedding model when configured',
        '/api/upload text source -> persisted chunks and zvec',
        '/api/ingestion/sources uploaded source detail',
        '/api/ai/chat grounded SSE',
        '/api/ai/chat persisted-vector retrieval',
        '/api/ai/chat citation audit',
      ],
      testConfig: {
        status: testConfigResponse.status,
        model: testConfig.model,
        visionModel: testConfig.visionModel,
        embeddingModel: testConfig.embeddingModel,
        sampleLength: testConfig.sample?.length,
        visionSampleLength: testConfig.visionSample?.length,
        embeddingDimension: testConfig.embeddingDimension,
      },
      uploaded: {
        sourceId: uploaded.id,
        ingestionStatus: uploaded.ingestionStatus,
        chunkCount: uploaded.ingestionChunkCount,
        vectorIndexStatus: uploaded.vectorIndex?.status,
        vectorIndexedCount: uploaded.vectorIndex?.indexedCount,
        sourceDetailStatus: sourceDetail.source?.status,
      },
      chat: {
        status: chatResponse.status,
        contentLength: chat.content.trim().length,
        citationCount: chat.citations.length,
        retrievalMode: chat.retrieval?.mode,
        retrievalDegraded: chat.retrieval?.degraded,
        retrievalReason: chat.retrieval?.reason,
        citationAuditStatus: chat.citationAudit?.status,
      },
    }, null, 2));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = redactSecret(rawMessage, aiConfig.apiKey);
    const recentOutput = output.join('').slice(-2000);
    throw new Error(`${message}${recentOutput ? `\nRecent server output:\n${recentOutput}` : ''}`);
  } finally {
    killProcessTree(child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
