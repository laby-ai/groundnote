import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.PODCAST_POLLING_UI_TIMEOUT_MS || 45_000);

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
          reject(new Error('Unable to allocate a local podcast polling smoke app port.'));
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
      throw new Error(`Podcast polling smoke app exited before /api/health completed with code ${child.exitCode}.`);
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

async function expectVisible(locator, message, timeout = 15_000) {
  await locator.waitFor({ state: 'visible', timeout }).catch(error => {
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function expectVisibleOnPage(page, locator, message, timeout = 15_000) {
  await locator.waitFor({ state: 'visible', timeout }).catch(async error => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error(`${message}: ${error instanceof Error ? error.message : String(error)}\nVisible body excerpt:\n${bodyText.slice(0, 1600)}`);
  });
}

function podcastEvidence(sourceId) {
  return {
    citations: [{
      sourceId,
      chunkId: `${sourceId}-c1`,
      sourceTitle: `Podcast Polling Source ${sourceId}`,
      snippet: 'podcast grounded citation',
      score: 1,
    }],
    retrieval: {
      mode: 'persisted-keyword',
      persistedSourceCount: 1,
      vectorIndexedSourceCount: 0,
      degraded: true,
      reason: 'embedding index not configured in podcast polling smoke',
    },
  };
}

async function interceptUpload(page, sourceId) {
  let hitCount = 0;
  await page.route('**/api/upload', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          id: sourceId,
          title: `Podcast Polling Source ${sourceId}`,
          authors: ['Smoke Test'],
          year: 2026,
          keywords: ['podcast', 'polling'],
          abstract: 'Source for validating podcast polling UI.',
          content: 'Podcast generation should expose task polling, completed audio, failed status, and retry affordance.',
          rawContent: 'Podcast generation should expose task polling, completed audio, failed status, and retry affordance.',
          shortName: 'PodcastPolling',
          fileName: `${sourceId}.txt`,
          fileType: 'txt',
          fileSize: 160,
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

async function interceptChatStream(page, sourceId) {
  let hitCount = 0;
  await page.route('**/api/ai/chat', async route => {
    hitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        `data: {"citations":[{"sourceId":"${sourceId}","chunkId":"${sourceId}-c1","sourceTitle":"Podcast Polling Source","snippet":"podcast prompt citation","score":1}],"retrieval":{"mode":"persisted-keyword","persistedSourceCount":1,"vectorIndexedSourceCount":0}}`,
        '',
        'data: {"content":"已把播客 prompt 放入中央对话。"}',
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

async function interceptPodcast(page, scenario, sourceId) {
  let postHits = 0;
  let getHits = 0;
  const evidence = podcastEvidence(sourceId);
  await page.route('**/api/ai/podcast**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      postHits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: 'running',
          taskId: `${scenario}-task`,
          message: '播客任务已提交，正在等待音频生成。',
          job: {
            id: `${scenario}-task`,
            type: 'podcast',
            status: 'running',
            stage: 'synthesizing-audio',
            progress: 45,
            message: '播客任务已提交，正在等待音频生成。',
          },
          retryAfterSeconds: 3,
          citations: evidence.citations,
          retrieval: evidence.retrieval,
        }),
      });
      return;
    }

    getHits += 1;
    if (scenario === 'completed') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          taskId: `${scenario}-task`,
          status: 'completed',
          audioUrl: 'data:audio/mpeg;base64,SUQz',
          message: '播客音频已生成。',
          job: {
            id: `${scenario}-task`,
            type: 'podcast',
            status: 'succeeded',
            stage: 'completed',
            progress: 100,
            message: '播客音频已生成。',
            artifact: {
              kind: 'audio',
              url: 'data:audio/mpeg;base64,SUQz',
            },
          },
          dialoguePreview: '主播甲：这段播客解释 StudioJob 如何保留引用证据。',
          segments: [{
            index: 0,
            status: 'succeeded',
            audioUrl: 'data:audio/mpeg;base64,SUQz',
            text: '主播甲：这段播客解释 StudioJob 如何保留引用证据。',
          }],
          citations: evidence.citations,
          retrieval: evidence.retrieval,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        taskId: `${scenario}-task`,
        status: 'failed',
        error: '上游音频合成失败，请重试',
        errorType: 'rate_limit',
        retryable: true,
        job: {
          id: `${scenario}-task`,
          type: 'podcast',
          status: 'failed',
          stage: 'synthesizing-audio',
          progress: 70,
          message: '上游音频合成失败，请重试',
          error: {
            message: '上游音频合成失败，请重试',
            type: 'rate_limit',
            retryable: true,
          },
        },
        dialoguePreview: '主播甲：脚本已经生成。主播乙：音频额度不足，需要稍后重试。',
        segments: [{
          index: 0,
          status: 'failed',
          text: '主播甲：脚本已经生成。主播乙：音频额度不足，需要稍后重试。',
          error: 'QuotaExceeded.AgentPlanQuotaExceeded',
        }],
        citations: evidence.citations,
        retrieval: evidence.retrieval,
      }),
    });
  });
  return {
    postHits: () => postHits,
    getHits: () => getHits,
  };
}

async function runScenario(browser, appOrigin, uploadPath, scenario) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const sourceId = `podcast-${scenario}-source`;
  const uploadHits = await interceptUpload(page, sourceId);
  const chatHits = await interceptChatStream(page, sourceId);
  const podcastHits = await interceptPodcast(page, scenario, sourceId);

  await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
  await expectVisible(page.getByText('Studio', { exact: true }), 'Workbench Studio panel did not render.');
  await page.locator('input[type="file"]').setInputFiles(uploadPath);
  await expectVisible(page.getByTestId('library-selection-count').getByText('已选 1 个来源'), 'Uploaded source was not selected.');

  await page.getByRole('button', { name: '语音摘要' }).click();
  await expectVisible(page.getByRole('button', { name: '生成语音摘要' }), 'Podcast generate button did not enable.');
  await page.getByRole('button', { name: '生成语音摘要' }).click();
  await expectVisibleOnPage(page, page.getByTestId('podcast-job-progress'), 'Podcast StudioJob progress panel did not render.');
  await expectVisible(page.getByText('播客任务已提交，正在等待音频生成。'), 'Podcast submitted state did not render.');

  if (scenario === 'completed') {
    await expectVisible(page.getByText('播客音频已生成。'), 'Podcast completed message did not render.', 12_000);
    await expectVisible(page.getByText('资料语音摘要'), 'Podcast audio player did not render after completed status.');
    await expectVisibleOnPage(page, page.getByTestId('podcast-segments').getByText('1/1 已生成'), 'Podcast completed segment status did not render.');
    await expectVisible(page.getByText('播客脚本预览'), 'Podcast completed dialogue preview did not render.');
    await expectVisible(page.getByText('证据状态', { exact: true }), 'Podcast evidence status did not render.');
    await expectVisible(page.getByTestId('studio-retrieval-badge').getByText(/持久片段检索 · 引用 1/), 'Podcast retrieval badge did not render citation count.');
    await expectVisible(page.getByText('当前检索说明：embedding index not configured in podcast polling smoke'), 'Podcast degradation reason did not render.');
    await expectVisible(page.getByText(`Podcast Polling Source ${sourceId}`).first(), 'Podcast citation source title did not render.');
  } else {
    await expectVisible(page.getByTestId('podcast-status').getByText('上游音频合成失败，请重试'), 'Podcast failed message did not render.', 12_000);
    await expectVisible(page.getByTestId('podcast-segments').getByText('0/1 已生成'), 'Podcast failed segment status did not render.');
    await expectVisible(page.getByText('播客脚本预览'), 'Podcast failed dialogue preview did not render.');
    await expectVisible(page.getByText('待重试'), 'Podcast failed segment retry state did not render.');
    await expectVisible(page.getByText('证据状态', { exact: true }), 'Podcast failed evidence status did not render.');
    await expectVisible(page.getByTestId('podcast-job-failed'), 'Podcast failed StudioJob progress panel did not render.');
    await expectVisible(page.getByRole('button', { name: '生成语音摘要' }), 'Podcast retry action did not become available after failed status.');
  }

  await page.close();
  return {
    upload: uploadHits(),
    chat: chatHits(),
    podcastPost: podcastHits.postHits(),
    podcastGet: podcastHits.getHits(),
  };
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-podcast-polling-ui-'));
  const uploadPath = path.join(tempDir, 'podcast-polling.txt');
  await writeFile(uploadPath, 'Podcast polling smoke source.', 'utf8');

  let smokeApp;
  let browser;

  try {
    smokeApp = await resolveSmokeApp(tempDir);
    const { appOrigin } = smokeApp;
    browser = await chromium.launch({ headless: true });

    const completed = await runScenario(browser, appOrigin, uploadPath, 'completed');
    const failed = await runScenario(browser, appOrigin, uploadPath, 'failed');

    assert(completed.podcastPost === 1 && completed.podcastGet >= 1, 'Completed scenario did not issue POST and GET podcast requests.');
    assert(failed.podcastPost === 1 && failed.podcastGet >= 1, 'Failed scenario did not issue POST and GET podcast requests.');

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      checked: [
        'podcast taskId submitted state is visible',
        'podcast completed polling status renders audio player',
        'podcast completed status renders grounded evidence and degradation reason',
        'podcast failed polling status renders recoverable retry message',
        'podcast retry action becomes available after failed status',
      ],
      requests: {
        completed,
        failed,
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
