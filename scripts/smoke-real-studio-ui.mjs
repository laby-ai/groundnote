import './lib/load-real-env.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const startupTimeoutMs = Number(process.env.REAL_STUDIO_UI_STARTUP_TIMEOUT_MS || 45_000);
const cardTimeoutMs = Number(process.env.REAL_STUDIO_UI_CARDS_TIMEOUT_MS || 180_000);
const podcastTimeoutMs = Number(process.env.REAL_STUDIO_UI_PODCAST_TIMEOUT_MS || 180_000);

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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local real Studio UI smoke port.'));
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
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Real Studio UI smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

async function expectVisible(locator, message, timeout = 60_000) {
  await locator.waitFor({ state: 'visible', timeout }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function parseUploadResponse(response) {
  const status = response.status();
  const body = await response.json().catch(async () => {
    const text = await response.text().catch(() => '');
    throw new Error(`Upload response was not JSON. status=${status}, body=${text.slice(0, 1000)}`);
  });

  if (!response.ok || body?.success !== true) {
    throw new Error(`Upload failed before ingestion. status=${status}, body=${JSON.stringify(body).slice(0, 1200)}`);
  }

  const failures = (body.results || []).filter(item => item?.error);
  if (failures.length > 0) {
    throw new Error(`Upload returned per-file errors: ${JSON.stringify(failures).slice(0, 1200)}`);
  }

  const uploaded = (body.results || [])[0];
  if (!uploaded?.id) {
    throw new Error(`Upload response did not include a source id: ${JSON.stringify(body).slice(0, 1200)}`);
  }
  return uploaded;
}

async function waitForUploadedSource(origin, expected) {
  const deadline = Date.now() + 180_000;
  let lastBody = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/ingestion/sources`, { cache: 'no-store' });
    const body = await response.json();
    lastBody = JSON.stringify(body);
    const source = body.sources?.find(item => (
      (expected.id && item.id === expected.id)
      || (!expected.id && item.fileName === expected.fileName)
    ));
    if (source?.id && source.status === 'succeeded' && source.chunkCount > 0) return source;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for uploaded source ${expected.id || expected.fileName}. Last body: ${lastBody}`);
}

async function startApp(tempDir) {
  if (process.env.REAL_STUDIO_UI_ORIGIN) {
    return { origin: process.env.REAL_STUDIO_UI_ORIGIN.replace(/\/$/, ''), child: null, external: true };
  }

  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_RUNTIME_ENV: process.env.REAL_STUDIO_UI_RUNTIME_ENV || 'production',
      NODE_ENV: process.env.REAL_STUDIO_UI_RUNTIME_ENV || 'production',
      FILE_STORAGE_ADAPTER: process.env.REAL_STUDIO_UI_FILE_STORAGE_ADAPTER || process.env.FILE_STORAGE_ADAPTER || 'local',
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
      AI_TEST_CONFIG_TEXT_TIMEOUT_MS: process.env.AI_TEST_CONFIG_TEXT_TIMEOUT_MS || '45000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  return { origin, child, external: false };
}

async function summarizeResponseJson(responsePromise) {
  const response = await responsePromise;
  const body = await response.json();
  return {
    status: response.status(),
    body,
  };
}

async function main() {
  const aiConfig = buildAiConfig();
  const missing = [
    aiConfig.apiBase ? '' : 'OPENAI_COMPAT_API_BASE or ARK_API_BASE',
    aiConfig.apiKey ? '' : 'OPENAI_COMPAT_API_KEY or ARK_API_KEY',
    aiConfig.model ? '' : 'OPENAI_COMPAT_MODEL or ARK_MODEL',
    aiConfig.embeddingModel ? '' : 'OPENAI_COMPAT_EMBEDDING_MODEL or ARK_EMBEDDING_MODEL',
    aiConfig.ttsSpeaker ? '' : 'AGENTPLAN_TTS_SPEAKER or DOUBAO_TTS_SPEAKER',
    envFirst('AGENTPLAN_TTS_RESOURCE_ID', 'DOUBAO_TTS_RESOURCE_ID', 'AGENTPLAN_TTS_RESOURCE_ID') ? '' : 'AGENTPLAN_TTS_RESOURCE_ID',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log(JSON.stringify({ ok: true, skipped: true, realService: false, missing }, null, 2));
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-real-studio-ui-'));
  const evidenceDir = path.resolve('.deploy/evidence');
  await mkdir(evidenceDir, { recursive: true });
  const uploadFileName = `real-studio-ui-${Date.now()}.txt`;
  const uploadPath = path.join(tempDir, uploadFileName);
  await writeFile(uploadPath, [
    '灵笔工作室右侧 Studio 真实前端 smoke 资料。',
    '第 1 页：资料源可信、中央对话、右侧 Studio 和引用可追溯必须复用同一份 grounded context。',
    '第 2 页：知识卡片需要显示来源、检索状态和 citation audit，不能只给漂亮卡片。',
    '第 3 页：播客必须通过豆包 AgentPlan TTS 生成真实音频，并展示等待、完成和证据状态。',
    '第 4 页：长任务必须有阶段提示、取消入口、失败恢复和用户可理解的等待文案。',
  ].join('\n'), 'utf8');

  const { origin, child, external } = await startApp(tempDir);
  const output = [];
  child?.stdout.on('data', chunk => output.push(String(chunk)));
  child?.stderr.on('data', chunk => output.push(String(chunk)));

  let browser;
  const startedAt = Date.now();
  const partial = {
    ok: false,
    realService: true,
    origin,
    externalOrigin: external,
    durationMs: 0,
    health: null,
    uploaded: null,
    knowledgeCards: null,
    podcast: null,
    screenshotPath: null,
    checked: [],
    clientEvents: [],
  };
  let page;
  let partialPrinted = false;
  try {
    const health = await waitForHealth(origin, child);
    partial.health = {
      service: health.service,
      fileStorageAdapter: health.capabilities?.fileStorageAdapter,
      sourceStore: health.capabilities?.sourceStore,
      vectorStore: health.capabilities?.vectorStore,
    };
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page = await context.newPage();
    const clientEvents = [];
    partial.clientEvents = clientEvents;
    page.on('console', message => {
      clientEvents.push({ type: `console:${message.type()}`, text: message.text().slice(0, 500) });
    });
    page.on('pageerror', error => {
      clientEvents.push({ type: 'pageerror', text: error.message.slice(0, 500) });
    });
    page.on('requestfailed', request => {
      clientEvents.push({ type: 'requestfailed', url: request.url(), text: request.failure()?.errorText || '' });
    });

    await page.addInitScript(config => {
      window.localStorage.setItem('lingbi-ai-config', JSON.stringify(config));
      window.sessionStorage.clear();
    }, aiConfig);

    await page.goto(`${origin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('Studio', { exact: true }), 'Workbench Studio panel did not render.', 30_000);
    partial.checked.push('browser opened real workbench');

    await page.getByTestId('studio-nav-knowledge').click();
    const knowledgeNoSourceButton = page.getByTestId('knowledge-generate');
    await expectVisible(knowledgeNoSourceButton, 'Knowledge-card no-source guard did not render.', 30_000);
    if (!(await knowledgeNoSourceButton.isDisabled())) throw new Error('Knowledge-card no-source button was not disabled.');
    partial.checked.push('knowledge-card no-source guard is visible and disabled');

    await page.getByTestId('studio-nav-audio').click();
    const podcastNoSourceButton = page.getByTestId('podcast-generate');
    await expectVisible(podcastNoSourceButton, 'Podcast no-source guard did not render.', 30_000);
    if (!(await podcastNoSourceButton.isDisabled())) throw new Error('Podcast no-source button was not disabled.');
    partial.checked.push('podcast no-source guard is visible and disabled');

    const uploadResponsePromise = page.waitForResponse(response => response.url().includes('/api/upload'), { timeout: 180_000 })
      .then(async response => ({ kind: 'upload-response', uploaded: await parseUploadResponse(response) }));
    const sourcePromise = waitForUploadedSource(origin, { fileName: uploadFileName })
      .then(source => ({ kind: 'source-store', source }));
    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    const uploadEvidence = await Promise.race([uploadResponsePromise, sourcePromise]);
    const uploaded = uploadEvidence.kind === 'upload-response'
      ? await waitForUploadedSource(origin, { id: uploadEvidence.uploaded.id, fileName: uploadFileName })
      : uploadEvidence.source;
    partial.uploaded = {
      sourceId: uploaded.id,
      status: uploaded.status,
      chunkCount: uploaded.chunkCount,
      fileName: uploaded.fileName,
    };

    const paperRow = page.getByTestId(`library-paper-${uploaded.id}`).first();
    await expectVisible(paperRow, 'Uploaded real Studio source row did not render.', 60_000);
    if (await page.getByTestId('library-selection-count').count() === 0 || await paperRow.getAttribute('aria-selected') !== 'true') {
      await paperRow.click();
    }
    await expectVisible(page.getByTestId('library-selection-count').first().filter({ hasText: '已选 1 篇' }), 'Uploaded source could not be selected.', 30_000);
    partial.checked.push('browser uploaded and selected a real source');

    await page.getByTestId('studio-nav-knowledge').click();
    const knowledgeGenerate = page.getByTestId('knowledge-generate');
    await expectVisible(knowledgeGenerate, 'Knowledge-card generate button did not render after source selection.', 30_000);
    if (await knowledgeGenerate.isDisabled()) throw new Error('Knowledge-card generate button stayed disabled after source selection.');
    const cardsResponsePromise = summarizeResponseJson(page.waitForResponse(response => response.url().endsWith('/api/ai/knowledge-cards'), { timeout: cardTimeoutMs }));
    await knowledgeGenerate.click();
    await expectVisible(page.getByTestId('knowledge-loading'), 'Knowledge-card real loading state did not render.', 30_000);
    partial.checked.push('knowledge-card real loading state rendered');
    const cardsResponse = await cardsResponsePromise;
    if (cardsResponse.status !== 200 || !Array.isArray(cardsResponse.body.cards) || cardsResponse.body.cards.length === 0) {
      throw new Error(`Knowledge-card real response was invalid: ${JSON.stringify(cardsResponse).slice(0, 1200)}`);
    }
    partial.knowledgeCards = {
      status: cardsResponse.status,
      cardCount: cardsResponse.body.cards.length,
      citationCount: Array.isArray(cardsResponse.body.citations) ? cardsResponse.body.citations.length : 0,
      retrievalMode: cardsResponse.body.retrieval?.mode,
      retrievalDegraded: cardsResponse.body.retrieval?.degraded,
      citationAuditStatus: cardsResponse.body.citationAudit?.status,
      firstTitle: cardsResponse.body.cards[0]?.title,
    };
    await expectVisible(page.getByTestId('knowledge-card-result'), 'Knowledge-card real result did not render.', 60_000);
    await expectVisible(page.getByTestId('knowledge-retrieval-badge'), 'Knowledge-card retrieval badge did not render.', 30_000);
    await expectVisible(page.getByTestId('knowledge-citation-audit-badge'), 'Knowledge-card citation audit badge did not render.', 30_000);
    partial.checked.push('knowledge-card real API response produced cards, citations, retrieval, and citation audit');
    partial.checked.push('knowledge-card result/retrieval/audit UI rendered');

    await page.getByTestId('studio-nav-audio').click();
    const podcastGenerate = page.getByTestId('podcast-generate');
    await expectVisible(podcastGenerate, 'Podcast generate button did not render after source selection.', 30_000);
    if (await podcastGenerate.isDisabled()) throw new Error('Podcast generate button stayed disabled after source selection.');
    const podcastResponsePromise = summarizeResponseJson(page.waitForResponse(response => response.url().endsWith('/api/ai/podcast'), { timeout: podcastTimeoutMs }));
    await podcastGenerate.click();
    await expectVisible(page.getByTestId('podcast-loading'), 'Podcast real loading state did not render.', 30_000);
    partial.checked.push('podcast real loading state rendered');
    const podcastResponse = await podcastResponsePromise;
    partial.podcast = {
      status: podcastResponse.status,
      success: podcastResponse.body?.success,
      provider: podcastResponse.body?.provider,
      podcastStatus: podcastResponse.body?.status,
      taskIdPresent: Boolean(podcastResponse.body?.taskId),
      jobStage: podcastResponse.body?.job?.stage,
      jobProgress: podcastResponse.body?.job?.progress,
      errorType: podcastResponse.body?.errorType,
      retryable: podcastResponse.body?.retryable,
      upstreamStatus: podcastResponse.body?.upstreamStatus,
      audioUrlPresent: Boolean(podcastResponse.body?.audioUrl),
    };
    if (![200, 202].includes(podcastResponse.status) || podcastResponse.body.success !== true || (!podcastResponse.body.audioUrl && !podcastResponse.body.taskId)) {
      await expectVisible(page.getByTestId('podcast-status'), 'Podcast failure status did not render after real API error.', 30_000);
      await expectVisible(page.getByTestId('studio-evidence-status').first(), 'Podcast failure evidence status did not render after real API error.', 30_000);
      partial.checked.push('podcast real failure state rendered with user-facing status and evidence');
      const failureScreenshotPath = path.join(evidenceDir, `real-studio-ui-failed-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await page.screenshot({ path: failureScreenshotPath, fullPage: false }).catch(() => undefined);
      partial.durationMs = Date.now() - startedAt;
      partial.screenshotPath = failureScreenshotPath;
      console.error(`real-studio-ui-partial ${JSON.stringify(partial, null, 2)}`);
      partialPrinted = true;
      throw new Error(`Podcast real response did not produce audio: ${JSON.stringify({
        status: podcastResponse.status,
        success: podcastResponse.body?.success,
        provider: podcastResponse.body?.provider,
        podcastStatus: podcastResponse.body?.status,
        taskIdPresent: Boolean(podcastResponse.body?.taskId),
        error: podcastResponse.body?.error,
      })}`);
    }
    await expectVisible(page.getByTestId('podcast-player'), 'Podcast player did not render after real audio generation.', 60_000);
    await expectVisible(page.getByTestId('studio-evidence-status').first(), 'Podcast evidence status did not render.', 30_000);

    const screenshotPath = path.join(evidenceDir, `real-studio-ui-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    partial.durationMs = Date.now() - startedAt;
    partial.screenshotPath = screenshotPath;
    partial.ok = true;
    partial.checked.push('podcast real Doubao AgentPlan TTS response produced audioUrl');
    partial.checked.push('podcast player and evidence status rendered');

    console.log(JSON.stringify({
      ok: true,
      realService: true,
      origin,
      externalOrigin: external,
      durationMs: Date.now() - startedAt,
      health: {
        service: health.service,
        fileStorageAdapter: health.capabilities?.fileStorageAdapter,
        sourceStore: health.capabilities?.sourceStore,
        vectorStore: health.capabilities?.vectorStore,
      },
      uploaded: {
        sourceId: uploaded.id,
        status: uploaded.status,
        chunkCount: uploaded.chunkCount,
        fileName: uploaded.fileName,
      },
      knowledgeCards: {
        status: cardsResponse.status,
        cardCount: cardsResponse.body.cards.length,
        citationCount: Array.isArray(cardsResponse.body.citations) ? cardsResponse.body.citations.length : 0,
        retrievalMode: cardsResponse.body.retrieval?.mode,
        retrievalDegraded: cardsResponse.body.retrieval?.degraded,
        citationAuditStatus: cardsResponse.body.citationAudit?.status,
        firstTitle: cardsResponse.body.cards[0]?.title,
      },
      podcast: {
        status: podcastResponse.status,
        provider: podcastResponse.body.provider,
        podcastStatus: podcastResponse.body.status,
        taskIdPresent: Boolean(podcastResponse.body.taskId),
        jobStage: podcastResponse.body.job?.stage,
        jobProgress: podcastResponse.body.job?.progress,
        audioUrlPresent: Boolean(podcastResponse.body.audioUrl),
        audioUrlType: String(podcastResponse.body.audioUrl || '').startsWith('/uploads/') ? 'local-upload' : 'url',
        citationCount: Array.isArray(podcastResponse.body.citations) ? podcastResponse.body.citations.length : 0,
        retrievalMode: podcastResponse.body.retrieval?.mode,
        retrievalDegraded: podcastResponse.body.retrieval?.degraded,
      },
      checked: [
        'browser opened real workbench',
        'knowledge-card no-source guard is visible and disabled',
        'podcast no-source guard is visible and disabled',
        'browser uploaded and selected a real source',
        'knowledge-card real loading state rendered',
        'knowledge-card real API response produced cards, citations, retrieval, and citation audit',
        'knowledge-card result/retrieval/audit UI rendered',
        'podcast real loading state rendered',
        'podcast real Doubao AgentPlan TTS response produced audioUrl',
        'podcast player and evidence status rendered',
      ],
      screenshotPath,
      clientEvents: clientEvents.slice(-20),
    }, null, 2));
  } catch (error) {
    if (page && !partial.screenshotPath) {
      const failureScreenshotPath = path.join(evidenceDir, `real-studio-ui-failed-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await page.screenshot({ path: failureScreenshotPath, fullPage: false }).catch(() => undefined);
      partial.screenshotPath = failureScreenshotPath;
    }
    partial.durationMs = Date.now() - startedAt;
    if (!partialPrinted) console.error(`real-studio-ui-partial ${JSON.stringify(partial, null, 2)}`);
    const recentOutput = output.join('').slice(-2000);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${recentOutput ? `\nRecent server output:\n${recentOutput}` : ''}`);
  } finally {
    await browser?.close().catch(() => undefined);
    if (!external) killProcessTree(child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
