import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.STUDIO_QUALITY_WARNING_TIMEOUT_MS || 45_000);

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
          reject(new Error('Unable to allocate a local Studio quality smoke app port.'));
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
      throw new Error(`Studio quality smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

async function expectVisible(locator, message) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function interceptUpload(page) {
  let hitCount = 0;
  await page.route('**/api/upload', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          id: 'quality-warning-source',
          title: 'Quality Warning Source',
          authors: ['Smoke Test'],
          year: 2026,
          keywords: ['quality-warning', 'ppt-v2'],
          abstract: 'Source for validating PPT-v2 quality warnings.',
          content: 'PPT-v2 should show non-blocking quality warnings when the backend reports fallback stages.',
          rawContent: 'PPT-v2 should show non-blocking quality warnings when the backend reports fallback stages.',
          shortName: 'QualityWarning',
          fileName: 'quality-warning.txt',
          fileType: 'txt',
          fileSize: 180,
          uploadTime: new Date().toISOString(),
          ingestionStatus: 'succeeded',
          ingestionStages: [{ name: 'chunk', status: 'succeeded' }],
          ingestionChunkCount: 1,
          vectorIndex: { status: 'not_configured', count: 0 },
          mineruFigures: [],
        }],
      }),
    });
  });
  return () => hitCount;
}

async function interceptChatStream(page) {
  let hitCount = 0;
  await page.route('**/api/ai/chat', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'data: {"citations":[{"sourceId":"quality-warning-source","chunkId":"quality-warning-source-c1","sourceTitle":"Quality Warning Source","snippet":"Studio quality warning citation","score":1}],"retrieval":{"mode":"persisted-keyword","persistedSourceCount":1,"vectorIndexedSourceCount":0}}',
        '',
        'data: {"content":"已把右侧 Studio prompt 放入中央对话。"}',
        '',
        'data: {"citationAudit":{"status":"pass","validMarkers":[1],"invalidMarkers":[],"missingMarkers":[]}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
    });
  });
  return () => hitCount;
}

async function interceptPptV2Warning(page) {
  let hitCount = 0;
  const observability = encodeURIComponent(JSON.stringify({
    totalCalls: 3,
    succeeded: 3,
    failed: 0,
    fallbacks: 2,
    failedStages: [],
    fallbackStages: ['criticSlidePlan', 'generateSpeakerNotes'],
    details: [],
  }));

  await page.route('**/api/ai/ppt-v2', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="quality-warning-smoke.pptx"',
        'X-LLM-Observability': observability,
      },
      body: Buffer.from('PK\u0003\u0004quality-warning-smoke-pptx'),
    });
  });
  return () => hitCount;
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-studio-quality-warning-'));
  const uploadPath = path.join(tempDir, 'quality-warning.txt');
  await writeFile(uploadPath, 'PPT-v2 quality warning smoke source.', 'utf8');

  let smokeApp;
  let browser;

  try {
    smokeApp = await resolveSmokeApp(tempDir);
    const { appOrigin } = smokeApp;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    const uploadHits = await interceptUpload(page);
    const chatHits = await interceptChatStream(page);
    const pptV2Hits = await interceptPptV2Warning(page);

    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('Studio', { exact: true }), 'Workbench Studio panel did not render.');

    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    await expectVisible(page.getByText('已选 1 篇'), 'Uploaded source was not selected.');
    await expectVisible(page.getByText('Quality Warning Source'), 'Uploaded source did not render.');

    await page.getByRole('button', { name: '学术报告' }).click();
    await expectVisible(page.getByRole('button', { name: '生成学术报告' }), 'Academic report button did not enable after source selection.');
    await page.getByRole('button', { name: '生成学术报告' }).click();

    await expectVisible(page.getByText('正在初始化 ArcDeck 学术报告管道...'), 'Academic PPT staged progress did not start.');
    await expectVisible(page.getByText('PPT生成完成'), 'Academic PPT success state did not render.');
    await expectVisible(page.getByText(/部分环节降级处理/), 'Academic PPT quality warning did not persist after success.');
    await expectVisible(page.getByText(/criticSlidePlan/), 'Academic PPT warning did not name the fallback stage.');
    await expectVisible(page.getByRole('button', { name: '下载PPT文件' }), 'Academic PPT download action did not render.');

    const bodyText = await page.locator('body').innerText();
    assert(!bodyText.includes('ui-flow-key-not-secret'), 'Visible Studio quality warning leaked a test API key.');

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      checked: [
        'uploaded source becomes selected',
        'academic PPT-v2 staged progress starts',
        'PPT-v2 success state renders after binary response',
        'X-LLM-Observability fallback stages become a visible non-blocking quality warning',
        'download action remains available after warning',
        'visible warning does not leak API keys',
      ],
      requests: {
        upload: uploadHits(),
        chat: chatHits(),
        pptV2: pptV2Hits(),
      },
    }, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    killProcessTree(smokeApp?.child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
