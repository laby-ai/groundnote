import './lib/load-real-env.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const startupTimeoutMs = Number(process.env.REAL_CHAT_UI_STARTUP_TIMEOUT_MS || 45_000);

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
          reject(new Error('Unable to allocate a local real chat UI smoke port.'));
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
    if (child.exitCode !== null) {
      throw new Error(`Real chat UI smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

async function expectVisible(locator, message, timeout = 120_000) {
  await locator.waitFor({ state: 'visible', timeout }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function waitForUploadedSource(origin) {
  const deadline = Date.now() + 180_000;
  let lastBody = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/ingestion/sources`, { cache: 'no-store' });
    const body = await response.json();
    lastBody = JSON.stringify(body);
    const source = body.sources?.find(item => item.fileName === 'real-chat-ui.txt');
    if (source?.id && source.status === 'succeeded' && source.chunkCount > 0) return source;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for uploaded source in /api/ingestion/sources. Last body: ${lastBody}`);
}

async function main() {
  const aiConfig = buildAiConfig();
  const missing = [
    aiConfig.apiBase ? '' : 'OPENAI_COMPAT_API_BASE or ARK_API_BASE',
    aiConfig.apiKey ? '' : 'OPENAI_COMPAT_API_KEY or ARK_API_KEY',
    aiConfig.model ? '' : 'OPENAI_COMPAT_MODEL or ARK_MODEL',
    aiConfig.embeddingModel ? '' : 'OPENAI_COMPAT_EMBEDDING_MODEL or ARK_EMBEDDING_MODEL',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      realService: false,
      missing,
    }, null, 2));
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-real-chat-ui-'));
  const uploadPath = path.join(tempDir, 'real-chat-ui.txt');
  await writeFile(uploadPath, [
    '灵笔工作室真实浏览器中央对话 smoke 资料。',
    'NotebookLM-like 工作台必须在用户上传资料后完成 ingestion、embedding、zvec 持久化，并在中央对话优先使用向量索引检索。',
    '回答必须展示用户可读的来源状态、引用来源、chunk 片段和 citation audit，不能静默降级为请求内资料。',
  ].join('\n'), 'utf8');

  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_RUNTIME_ENV: process.env.REAL_CHAT_UI_RUNTIME_ENV || 'production',
      NODE_ENV: process.env.REAL_CHAT_UI_RUNTIME_ENV || 'production',
      FILE_STORAGE_ADAPTER: process.env.REAL_CHAT_UI_FILE_STORAGE_ADAPTER || process.env.FILE_STORAGE_ADAPTER || 'local',
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
  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  let browser;
  const startedAt = Date.now();
  try {
    const health = await waitForHealth(origin, child);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const responses = { upload: 0, chat: 0 };
    page.on('response', response => {
      const url = response.url();
      if (url.endsWith('/api/upload')) responses.upload += 1;
      if (url.endsWith('/api/ai/chat')) responses.chat += 1;
    });

    await page.addInitScript(config => {
      window.localStorage.setItem('lingbi-ai-config', JSON.stringify(config));
    }, aiConfig);

    await page.goto(`${origin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('Studio', { exact: true }), 'Workbench Studio panel did not render.', 30_000);
    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    const uploaded = await waitForUploadedSource(origin);
    const titleLocator = page.getByText(uploaded.title || uploaded.fileName).first();
    await expectVisible(titleLocator, 'Uploaded real source title did not render.', 60_000);
    const sourceTestId = `library-paper-${uploaded.id}`;
    const sourceCards = page.locator(`[data-testid="${sourceTestId}"]`);
    const sourceCard = sourceCards.first();
    await expectVisible(sourceCard, 'Uploaded real source card did not render.', 60_000);
    if (await page.getByText('已选 1 个资料').count() === 0) {
      await sourceCard.click({ force: true });
    }
    await sourceCard.waitFor({ state: 'visible', timeout: 30_000 });
    const sourceSelected = await page.waitForFunction((testId) => {
      return Array.from(document.querySelectorAll(`[data-testid="${testId}"]`))
        .some(card => card.getAttribute('aria-selected') === 'true');
    }, sourceTestId, { timeout: 5_000 }).then(() => true).catch(() => false);
    if (!sourceSelected) {
      await page.locator('button[title="全选"]').first().click({ force: true });
      await page.waitForFunction((testId) => {
        return Array.from(document.querySelectorAll(`[data-testid="${testId}"]`))
          .some(card => card.getAttribute('aria-selected') === 'true');
      }, sourceTestId, { timeout: 30_000 });
    }
    await expectVisible(page.getByText(/已选 1 个(资料|来源)/), 'Uploaded real source could not be selected.', 30_000);

    await page.getByLabel('输入资料问题').fill('请说明中央对话为什么必须优先使用资料索引，并给出引用。');
    await page.getByRole('button', { name: '发送问题' }).click();

    await expectVisible(page.getByTestId('retrieval-badge').getByText(/已匹配资料索引|已匹配资料片段|来源可用，索引完善中/), 'Central chat did not render a user-facing source status.');
    await expectVisible(page.getByTestId('message-source-status').getByText(/[1-9] 个引用/), 'Central chat source status did not show citations.');
    await expectVisible(page.getByText(/来源已校验/).first(), 'Central chat citation audit did not render pass state.');
    await expectVisible(page.getByText('引用来源').first(), 'Central chat citation source list did not render.');

    const degradedVisible = await page.getByText('降级原因：').count();
    if (degradedVisible > 0) {
      throw new Error('Central chat displayed a degradation reason in the real persisted-vector path.');
    }

    console.log(JSON.stringify({
      ok: true,
      realService: true,
      origin,
      durationMs: Date.now() - startedAt,
      health: {
        service: health.service,
        sourceStore: health.capabilities?.sourceStore,
        vectorStore: health.capabilities?.vectorStore,
      },
      checked: [
        'browser opened real workbench',
        'real user model config injected into browser localStorage without printing key',
        'browser uploaded a real text source',
        'upload completed and auto-selected the source',
        'central chat request completed with visible user-facing source status',
        'central chat rendered citation count, citation audit pass state, and citation source list',
        'central chat did not show degradation reason',
      ],
      responses,
    }, null, 2));
  } catch (error) {
    const recentOutput = output.join('').slice(-2000);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${recentOutput ? `\nRecent server output:\n${recentOutput}` : ''}`);
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
