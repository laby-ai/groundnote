import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.MODEL_CONFIG_UI_SMOKE_TIMEOUT_MS || 45_000);
const fakeApiKey = 'ui-test-key-not-secret';

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
          reject(new Error('Unable to allocate a local model config smoke app port.'));
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
      throw new Error(`Model config smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

function startMockFailingOpenAIUpstream() {
  let hitCount = 0;
  const server = http.createServer(async (req, res) => {
    hitCount += 1;
    let body = '';
    for await (const chunk of req) body += String(chunk);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `invalid key ${fakeApiKey}`,
      authorization: `Bearer ${fakeApiKey}`,
      apiKey: fakeApiKey,
      receivedPath: req.url,
      receivedBodyHasKey: body.includes(fakeApiKey),
    }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate a local failing OpenAI-compatible upstream port.'));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}/v1`,
        getHitCount: () => hitCount,
        close: () => new Promise(closeResolve => server.close(() => closeResolve(undefined))),
      });
    });
  });
}

async function expectVisible(locator, message) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-model-config-ui-smoke-'));
  let smokeApp;
  let browser;
  let failingUpstream;
  let testConfigPayload;
  let testConfigHits = 0;

  try {
    smokeApp = await resolveSmokeApp(tempDir);
    const { appOrigin } = smokeApp;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await page.route('**/api/ai/test-config', async route => {
      testConfigHits += 1;
      testConfigPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          model: 'doubao-seed-2.0-pro',
          sample: 'OK',
          visionModel: 'ark-code-latest',
          visionSample: 'VISION_OK',
          embeddingModel: 'doubao-embedding-vision',
          embeddingDimension: 2560,
          ttsSpeaker: 'test-speaker',
        }),
      });
    });

    await page.goto(`${appOrigin}/#workbench-settings`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByRole('heading', { name: '模型设置' }), 'Model settings dialog did not open from #workbench-settings');
    await expectVisible(page.getByText(/文本、视觉、向量和播客音色分别用于问答、OCR、资料检索索引与豆包语音合成/), 'Model usage guidance did not render');

    const testButton = page.getByRole('button', { name: '测试模型连接' });
    assert(await testButton.isDisabled(), 'Test connection should be disabled before API Base and API Key are filled.');

    await page.getByLabel('API Base').fill('https://ark.cn-beijing.volces.com/api/plan/v3');
    await page.getByRole('textbox', { name: 'API Key' }).fill(fakeApiKey);
    await page.getByLabel('文本模型').fill('doubao-seed-2.0-pro');
    await page.getByLabel('视觉理解模型').fill('ark-code-latest');
    await page.getByLabel('向量模型').fill('doubao-embedding-vision');
    await page.getByLabel('播客音色').fill('test-speaker');

    assert(!(await testButton.isDisabled()), 'Test connection should become available after API Base and API Key are filled.');
    await testButton.click();
    await expectVisible(page.getByText('连接成功，文本模型 doubao-seed-2.0-pro、视觉理解模型 ark-code-latest、向量模型 doubao-embedding-vision (2560 维) 已响应。'), 'Model connection success summary did not include text, vision, and embedding models');
    await expectVisible(page.getByTestId('model-connection-checklist'), 'Model connection checklist did not render after a successful test');
    await expectVisible(page.getByTestId('model-check-text').getByText('文本问答'), 'Text model check row did not render');
    await expectVisible(page.getByTestId('model-check-text').getByText('已通过', { exact: true }), 'Text model check did not show success');
    await expectVisible(page.getByTestId('model-check-vision').getByText('视觉理解'), 'Vision model check row did not render');
    await expectVisible(page.getByTestId('model-check-vision').getByText('已通过', { exact: true }), 'Vision model check did not show success');
    await expectVisible(page.getByTestId('model-check-embedding').getByText('向量检索'), 'Embedding model check row did not render');
    await expectVisible(page.getByTestId('model-check-embedding').getByText('已通过', { exact: true }), 'Embedding model check did not show success');
    await expectVisible(page.getByTestId('model-check-embedding').getByText('2560 维向量'), 'Embedding model check did not show vector dimension');
    await expectVisible(page.getByTestId('model-check-tts'), 'TTS speaker check row did not render');
    await expectVisible(page.getByTestId('model-check-tts').getByText('已通过', { exact: true }), 'TTS speaker check did not show ready state');

    assert(testConfigHits === 1, 'Model test endpoint should be called exactly once.');
    const aiConfig = testConfigPayload?.aiConfig || {};
    assert(aiConfig.apiBase === 'https://ark.cn-beijing.volces.com/api/plan/v3', 'API Base was not sent to the test endpoint.');
    assert(aiConfig.apiKey === fakeApiKey, 'API Key was not sent to the test endpoint.');
    assert(aiConfig.model === 'doubao-seed-2.0-pro', 'Text model was not sent to the test endpoint.');
    assert(aiConfig.visionModel === 'ark-code-latest', 'Vision model was not sent to the test endpoint.');
    assert(aiConfig.embeddingModel === 'doubao-embedding-vision', 'Embedding model was not sent to the test endpoint.');
    assert(aiConfig.ttsSpeaker === 'test-speaker', 'TTS speaker was not sent to the test endpoint.');

    const storedConfig = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingbi-ai-config');
      return raw ? JSON.parse(raw) : null;
    });
    assert(storedConfig?.apiBase === 'https://ark.cn-beijing.volces.com/api/plan/v3', 'Model config was not persisted to browser localStorage.');
    assert(storedConfig?.apiKey === fakeApiKey, 'API Key was not persisted to browser localStorage.');
    assert(storedConfig?.model === 'doubao-seed-2.0-pro', 'Text model was not persisted to browser localStorage.');
    assert(storedConfig?.visionModel === 'ark-code-latest', 'Vision model was not persisted to browser localStorage.');
    assert(storedConfig?.embeddingModel === 'doubao-embedding-vision', 'Embedding model was not persisted to browser localStorage.');
    assert(storedConfig?.ttsSpeaker === 'test-speaker', 'TTS speaker was not persisted to browser localStorage.');

    await page.getByRole('button', { name: '清空模型配置' }).click();
    await expectVisible(page.getByText('未填写完整配置时，仅可使用部署环境配置的默认模型服务；若部署环境没有默认模型，请先填写 API Base 和 API Key。'), 'Empty config deployment guidance did not render after clearing config');
    assert(await testButton.isDisabled(), 'Test connection should be disabled again after clearing config.');

    await page.unroute('**/api/ai/test-config');
    failingUpstream = await startMockFailingOpenAIUpstream();
    await page.getByLabel('API Base').fill(failingUpstream.origin);
    await page.getByRole('textbox', { name: 'API Key' }).fill(fakeApiKey);
    await page.getByLabel('文本模型').fill('bad-model');
    await testButton.click();
    await expectVisible(page.getByText(/OpenAI-compatible API error: 401/).first(), 'Model connection error did not render a recoverable error message');
    await expectVisible(page.getByTestId('model-check-text').getByText('失败', { exact: true }), 'Text model check did not show failure state');
    await expectVisible(page.getByTestId('model-check-vision').getByText('未单独测试'), 'Vision check should remain skipped when no vision model is set in the failure path');
    await expectVisible(page.getByTestId('model-check-embedding').getByText('未单独测试'), 'Embedding check should remain skipped when no embedding model is set in the failure path');
    await expectVisible(page.getByTestId('model-check-tts').getByText('未单独测试'), 'TTS check should remain skipped when no speaker is set in the failure path');
    const visibleText = await page.locator('body').innerText();
    assert(!visibleText.includes(fakeApiKey), 'Model connection error leaked the API Key into visible UI text.');
    assert(visibleText.includes('[REDACTED]'), 'Model connection error did not show redaction marker for sanitized secret content.');
    assert(failingUpstream.getHitCount() >= 1, 'Failing OpenAI-compatible mock upstream was not called.');

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      checked: [
        'settings dialog opens from #workbench-settings',
        'API Base/API Key/text/vision/embedding/TTS speaker fields are fillable',
        'test connection is disabled until required fields are filled',
        'test connection posts all three model names and TTS speaker to /api/ai/test-config',
        'success copy reports text, vision, and embedding checks',
        'per-model checklist reports text/vision/embedding/TTS readiness and embedding dimension',
        'config persists to browser localStorage',
        'clear config restores empty-state deployment guidance and disables testing',
        'failed real /api/ai/test-config path redacts API Key in visible UI and marks recoverable check state',
      ],
      requests: {
        testConfig: testConfigHits,
        failingUpstream: failingUpstream.getHitCount(),
      },
      models: {
        text: aiConfig.model,
        vision: aiConfig.visionModel,
        embedding: aiConfig.embeddingModel,
        ttsSpeaker: aiConfig.ttsSpeaker,
      },
    }, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    await failingUpstream?.close().catch(() => undefined);
    killProcessTree(smokeApp?.child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
