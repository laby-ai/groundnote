import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.WORKBENCH_FEATURE_SMOKE_TIMEOUT_MS || 30_000);

let appOrigin = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local smoke app port.'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Workbench smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

  throw new Error(`Timed out waiting for /api/health at ${origin}. Last error: ${lastError}`);
}

function killProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function resolveSmokeApp(tempDir) {
  if (process.env.APP_ORIGIN?.trim()) {
    return { appOrigin: process.env.APP_ORIGIN.trim(), child: undefined, managed: false };
  }

  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      ALLOW_INSECURE_API_BASE: 'true',
      ALLOW_PRIVATE_API_BASE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  try {
    await waitForHealth(origin, child);
    return { appOrigin: origin, child, managed: true, output };
  } catch (error) {
    const recentOutput = output.join('').slice(-4000);
    if (recentOutput) console.error(recentOutput);
    killProcessTree(child);
    throw error;
  }
}

async function getJson(urlPath) {
  const response = await fetch(`${appOrigin}${urlPath}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const body = await response.json();
  return { response, body };
}

async function postJson(urlPath, payload) {
  const response = await fetch(`${appOrigin}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  return { response, body };
}

async function uploadSmokeSource() {
  const text = [
    'Lingbi Studio workbench smoke source.',
    '第 1 页：右侧 Studio 的知识卡片、播客、报告和 PPT 都必须复用同一份 grounded context。',
    '第 2 页：PPT 生成需要明确 citation sourceId、chunkId、snippet 和 retrieval mode。',
    '第 3 页：当没有真实向量索引时，系统应该降级到持久片段检索，并把降级原因暴露给界面。',
  ].join('\n');
  const formData = new FormData();
  formData.append('files', new Blob([text], { type: 'text/plain' }), 'workbench-feature-smoke.txt');

  const response = await fetch(`${appOrigin}/api/upload`, { method: 'POST', body: formData });
  const body = await response.json();
  assert(response.ok, `/api/upload failed: ${JSON.stringify(body)}`);
  const uploaded = body.results?.[0];
  assert(uploaded?.id, `/api/upload did not return uploaded source id: ${JSON.stringify(body)}`);
  assert(uploaded.ingestionStatus === 'succeeded', `/api/upload did not finish ingestion: ${JSON.stringify(uploaded)}`);
  assert(uploaded.ingestionChunkCount > 0, `/api/upload did not create chunks: ${JSON.stringify(uploaded)}`);
  return uploaded;
}

function assertGroundedDebug(name, body, expectedSourceId) {
  assert(body.success === true, `${name} did not return success: ${JSON.stringify(body)}`);
  assert(Array.isArray(body.citations) && body.citations.length > 0, `${name} did not return citations: ${JSON.stringify(body)}`);
  assert(body.citations[0].sourceId === expectedSourceId, `${name} citation sourceId mismatch: ${JSON.stringify(body.citations[0])}`);
  assert(body.citations[0].chunkId, `${name} citation is missing chunkId: ${JSON.stringify(body.citations[0])}`);
  assert(body.retrieval?.mode === 'persisted-keyword' || body.retrieval?.mode === 'persisted-vector', `${name} did not use persisted retrieval: ${JSON.stringify(body.retrieval)}`);
  assert(body.retrieval?.persistedSourceCount >= 1, `${name} did not report persisted source count: ${JSON.stringify(body.retrieval)}`);
  assert(typeof body.retrieval?.degraded === 'boolean', `${name} did not report whether retrieval degraded: ${JSON.stringify(body.retrieval)}`);
  assert(typeof body.retrieval?.reason === 'string' && body.retrieval.reason.length > 0, `${name} did not report a user-facing retrieval reason: ${JSON.stringify(body.retrieval)}`);
  if (body.retrieval.mode === 'persisted-keyword') {
    assert(body.retrieval.degraded === true, `${name} persisted-keyword fallback should be marked degraded: ${JSON.stringify(body.retrieval)}`);
    assert(/向量|降级|持久化文本片段/.test(body.retrieval.reason), `${name} persisted-keyword fallback reason is not actionable: ${JSON.stringify(body.retrieval)}`);
  }
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-workbench-smoke-'));
  let smokeApp;

  try {
    smokeApp = await resolveSmokeApp(tempDir);
    appOrigin = smokeApp.appOrigin;

    const health = await getJson('/api/health');
    assert(health.response.ok && health.body.ok === true, `/api/health failed: ${JSON.stringify(health.body)}`);
    assert(health.body.capabilities?.sourceStore?.provider, 'health response did not expose source store provider');

    const uploaded = await uploadSmokeSource();
    const paper = {
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
    const papers = [paper];

    const sourceDetail = await getJson(`/api/ingestion/sources?id=${encodeURIComponent(uploaded.id)}`);
    assert(sourceDetail.response.ok, `/api/ingestion/sources?id failed: ${JSON.stringify(sourceDetail.body)}`);
    assert(sourceDetail.body.source?.status === 'succeeded', `uploaded source is not ready: ${JSON.stringify(sourceDetail.body.source)}`);
    assert(sourceDetail.body.source?.chunkCount > 0, `uploaded source has no chunks: ${JSON.stringify(sourceDetail.body.source)}`);

    const sourceList = await getJson('/api/ingestion/sources');
    assert(sourceList.response.ok, `/api/ingestion/sources failed: ${JSON.stringify(sourceList.body)}`);
    assert(sourceList.body.sources?.some(source => source.id === uploaded.id), 'uploaded source was not visible in source list');

    const chat = await postJson('/api/ai/chat', {
      message: '请说明右侧 Studio 产物为什么必须复用 grounded context。',
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: '右侧 Studio 产物必须复用统一证据链[1]。',
    });
    assert(chat.response.ok, `/api/ai/chat debug failed: ${JSON.stringify(chat.body)}`);
    assertGroundedDebug('chat', chat.body, uploaded.id);
    assert(chat.body.citationAudit?.status === 'pass', `chat citation audit did not pass: ${JSON.stringify(chat.body.citationAudit)}`);

    const report = await postJson('/api/ai/report', {
      outline: '统一 grounded context 的工程价值',
      papers,
      debugRetrievalOnly: true,
    });
    assert(report.response.ok, `/api/ai/report debug failed: ${JSON.stringify(report.body)}`);
    assertGroundedDebug('report', report.body, uploaded.id);

    const cards = await postJson('/api/ai/knowledge-cards', {
      papers,
      debugRetrievalOnly: true,
    });
    assert(cards.response.ok, `/api/ai/knowledge-cards debug failed: ${JSON.stringify(cards.body)}`);
    assertGroundedDebug('knowledge-cards', cards.body, uploaded.id);

    const podcast = await postJson('/api/ai/podcast', {
      content: '生成一段播客脚本，讨论 PPT 和 Studio 的统一证据链。',
      papers,
      debugRetrievalOnly: true,
    });
    assert(podcast.response.ok, `/api/ai/podcast debug failed: ${JSON.stringify(podcast.body)}`);
    assertGroundedDebug('podcast', podcast.body, uploaded.id);

    const ppt = await postJson('/api/ai/ppt', {
      papers,
      pageCount: 4,
      detailLevel: 'concise',
      language: 'zh',
      debugRetrievalOnly: true,
    });
    assert(ppt.response.ok, `/api/ai/ppt debug failed: ${JSON.stringify(ppt.body)}`);
    assertGroundedDebug('ppt', ppt.body, uploaded.id);

    const pptV2 = await postJson('/api/ai/ppt-v2', {
      papers,
      duration: 10,
      audience: 'researchers',
      debugRetrievalOnly: true,
    });
    assert(pptV2.response.ok, `/api/ai/ppt-v2 debug failed: ${JSON.stringify(pptV2.body)}`);
    assertGroundedDebug('ppt-v2', pptV2.body, uploaded.id);

    const emptyPpt = await postJson('/api/ai/ppt', { papers: [], debugRetrievalOnly: true });
    assert(emptyPpt.response.status === 400, `/api/ai/ppt should reject empty source selection: ${JSON.stringify(emptyPpt.body)}`);

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      uploadedSourceId: uploaded.id,
      sourceStore: health.body.capabilities.sourceStore,
      checked: [
        '/api/health source-store contract',
        '/api/upload text source -> ingestion stages/chunks',
        '/api/ingestion/sources list/detail',
        '/api/ai/chat debug grounded retrieval + citation audit',
        '/api/ai/report debug grounded retrieval',
        '/api/ai/knowledge-cards debug grounded retrieval',
        '/api/ai/podcast debug grounded retrieval',
        '/api/ai/ppt debug grounded retrieval',
        '/api/ai/ppt-v2 debug grounded retrieval',
        'all grounded debug routes expose retrieval.degraded and retrieval.reason',
        '/api/ai/ppt empty-selection user-facing guard',
      ],
      retrievalModes: {
        chat: chat.body.retrieval.mode,
        report: report.body.retrieval.mode,
        cards: cards.body.retrieval.mode,
        podcast: podcast.body.retrieval.mode,
        ppt: ppt.body.retrieval.mode,
        pptV2: pptV2.body.retrieval.mode,
      },
      chunkCount: sourceDetail.body.source.chunkCount,
    }, null, 2));
  } finally {
    killProcessTree(smokeApp?.child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
