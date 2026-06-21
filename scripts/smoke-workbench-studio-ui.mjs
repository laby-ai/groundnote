import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const workspace = process.cwd();
const startupTimeoutMs = Number(process.env.WORKBENCH_UI_SMOKE_TIMEOUT_MS || 45_000);
const configuredAI = {
  apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3',
  apiKey: 'studio-ui-key-not-secret',
  model: 'doubao-seed-2.0-pro',
  visionModel: 'ark-code-latest',
  embeddingModel: 'doubao-embedding-vision',
};

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
          reject(new Error('Unable to allocate a local UI smoke app port.'));
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
      throw new Error(`UI smoke app exited before /api/health completed with code ${child.exitCode}.`);
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
    return { appOrigin: process.env.APP_ORIGIN.trim(), child: undefined, managed: false, health: null };
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
    const health = await waitForHealth(origin, child);
    return { appOrigin: origin, child, managed: true, health, output };
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

async function expectDisabled(locator, message) {
  const disabled = await locator.isDisabled().catch(() => false);
  assert(disabled, message);
}

function assertAIConfig(config, routeName) {
  assert(config?.apiBase === configuredAI.apiBase, `${routeName} did not receive the configured API Base.`);
  assert(config?.apiKey === configuredAI.apiKey, `${routeName} did not receive the configured API Key.`);
  assert(config?.model === configuredAI.model, `${routeName} did not receive the configured text model.`);
  assert(config?.visionModel === configuredAI.visionModel, `${routeName} did not receive the configured vision model.`);
  assert(config?.embeddingModel === configuredAI.embeddingModel, `${routeName} did not receive the configured embedding model.`);
}

function assertSelectedPaperPayload(body, routeName) {
  const papers = Array.isArray(body?.papers) ? body.papers : [];
  assert(papers.length >= 1, `${routeName} did not receive selected papers.`);
  const paper = papers[0];
  assert(typeof paper.id === 'string' && paper.id.length > 0, `${routeName} did not receive selected paper id.`);
  assert(paper.fileName === 'studio-ui-smoke-source.txt', `${routeName} did not receive source fileName.`);
  assert(paper.fileType === 'txt', `${routeName} did not receive source fileType.`);
  assert(String(paper.rawContent || paper.content || '').includes('grounded context'), `${routeName} did not receive source content/rawContent.`);
}

async function interceptLongTask(page, pathname, routeName) {
  let hitCount = 0;
  await page.route(`**${pathname}`, async route => {
    hitCount += 1;
    const body = route.request().postDataJSON();
    assertAIConfig(body?.aiConfig, routeName);
    assertSelectedPaperPayload(body, routeName);
    await new Promise(resolve => setTimeout(resolve, 10_000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, cancelledSmokeResponse: true }),
    }).catch(() => undefined);
  });
  return () => hitCount;
}

async function interceptJson(page, pathname, payload, delayMs = 250, routeName = pathname) {
  let hitCount = 0;
  await page.route(`**${pathname}`, async route => {
    hitCount += 1;
    const body = route.request().postDataJSON();
    assertAIConfig(body?.aiConfig, routeName);
    assertSelectedPaperPayload(body, routeName);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  return () => hitCount;
}

async function interceptChatStream(page) {
  let hitCount = 0;
  await page.route('**/api/ai/chat', async route => {
    hitCount += 1;
    const body = route.request().postDataJSON();
    assertAIConfig(body?.aiConfig, '/api/ai/chat');
    assertSelectedPaperPayload(body, '/api/ai/chat');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'data: {"citations":[{"sourceId":"studio-ui-smoke","chunkId":"studio-ui-smoke-c1","sourceTitle":"Studio UI Smoke","snippet":"Studio prompt smoke citation","score":1}],"retrieval":{"mode":"persisted-keyword","persistedSourceCount":1,"vectorIndexedSourceCount":0}}',
        '',
        'data: {"content":"已收到 Studio Prompt，并将基于选中资料生成可追溯内容。"}',
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

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-studio-ui-smoke-'));
  const uploadPath = path.join(tempDir, 'studio-ui-smoke-source.txt');
  await writeFile(uploadPath, [
    'Lingbi Studio UI smoke source.',
    '第 1 页：右侧 Studio 的演示文稿、学术报告、知识卡片和播客都应该复用 grounded context。',
    '第 2 页：PPT 生成是长任务，必须显示等待进度、取消入口和可恢复文案。',
    '第 3 页：没有资料时按钮必须清晰禁用，不能让用户以为系统卡死。',
  ].join('\n'), 'utf8');

  let smokeApp;
  let browser;

  try {
    smokeApp = await resolveSmokeApp(tempDir);
    const { appOrigin } = smokeApp;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(config => {
      window.localStorage.setItem('lingbi-ai-config', JSON.stringify(config));
    }, configuredAI);

    await page.goto(`${appOrigin}/#workbench`, { waitUntil: 'networkidle' });
    await expectVisible(page.getByText('Studio', { exact: true }), 'Studio panel did not render');

    const noSourceButton = page.getByRole('button', { name: /先选择文献/ }).first();
    await expectVisible(noSourceButton, 'No-source PPT guard did not render');
    await expectDisabled(noSourceButton, 'No-source PPT guard should be disabled');

    await page.getByRole('button', { name: '学术报告' }).click();
    const noSourceAcademic = page.getByRole('button', { name: /先选择文献/ }).first();
    await expectVisible(noSourceAcademic, 'No-source academic report guard did not render');
    await expectDisabled(noSourceAcademic, 'No-source academic report guard should be disabled');
    await expectVisible(page.getByText('请先在左侧文献库中选择要分析的文献资料。').first(), 'Studio prompt should surface in the central chat when no source is selected');

    await page.getByRole('button', { name: '知识卡片' }).click();
    const noSourceCards = page.getByRole('button', { name: /先选择文献/ }).first();
    await expectVisible(noSourceCards, 'No-source knowledge-card guard did not render');
    await expectDisabled(noSourceCards, 'No-source knowledge-card guard should be disabled');

    await page.getByRole('button', { name: '音频播客' }).click();
    const noSourcePodcast = page.getByRole('button', { name: /先选择文献/ }).first();
    await expectVisible(noSourcePodcast, 'No-source podcast guard did not render');
    await expectDisabled(noSourcePodcast, 'No-source podcast guard should be disabled');

    await page.locator('input[type="file"]').setInputFiles(uploadPath);
    await expectVisible(page.getByText('已选 1 篇'), 'Uploaded source was not auto-selected');
    const chatHits = await interceptChatStream(page);

    await page.getByRole('button', { name: '演示文稿' }).click();
    await expectVisible(page.getByText('已收到 Studio Prompt'), 'Presentation Studio prompt did not enter central chat with selected source');
    assert(chatHits() >= 1, 'Presentation Studio prompt did not issue a grounded central chat request');
    await expectVisible(page.getByRole('button', { name: /一键生成 PPT/ }), 'PPT generate button did not become available after source selection');

    const pptHits = await interceptLongTask(page, '/api/ai/ppt', '/api/ai/ppt');
    await page.getByRole('button', { name: /一键生成 PPT/ }).click();
    await expectVisible(page.getByText('正在生成演示文稿，可随时取消后调整资料、页数或风格重新开始。'), 'PPT long-task waiting copy did not render');
    await expectVisible(page.getByRole('button', { name: '取消生成' }).first(), 'PPT cancel button did not render');
    await page.getByRole('button', { name: '取消生成' }).first().click();
    await expectVisible(page.getByText('已取消生成，可以调整资料、页数或风格后重新开始。'), 'PPT cancel recovery copy did not render');
    assert(pptHits() >= 1, 'PPT generation request was not issued');

    await page.getByRole('button', { name: '学术报告' }).click();
    await expectVisible(page.getByRole('button', { name: '生成学术报告' }), 'Academic report generate button did not become available after source selection');

    const pptV2Hits = await interceptLongTask(page, '/api/ai/ppt-v2', '/api/ai/ppt-v2');
    await page.getByRole('button', { name: '生成学术报告' }).click();
    await expectVisible(page.getByText('正在初始化 ArcDeck 学术报告管道...'), 'Academic report staged progress did not render');
    await expectVisible(page.getByText('真实模型长任务'), 'Academic report real-model long-task label did not render');
    await expectVisible(page.getByText(/已等待 \d+ 秒/), 'Academic report elapsed-time copy did not render');
    await expectVisible(page.getByText('正在调用真实模型和 PPTX 构建管道，生成期间可以随时取消。'), 'Academic report real-model waiting copy did not render');
    await expectVisible(page.getByRole('button', { name: '取消生成' }).first(), 'Academic report cancel button did not render');
    await page.getByRole('button', { name: '取消生成' }).first().click();
    await expectVisible(page.getByText('已取消生成，可以调整设置后重新开始。'), 'Academic report cancel recovery copy did not render');
    assert(pptV2Hits() >= 1, 'Academic PPT generation request was not issued');

    await page.getByRole('button', { name: '知识卡片' }).click();
    await expectVisible(page.getByRole('button', { name: '生成知识卡片' }), 'Knowledge-card generate button did not become available after source selection');
    const knowledgeHits = await interceptJson(page, '/api/ai/knowledge-cards', {
      cards: [{
        category: '核心发现',
        title: '为什么要统一证据链？',
        content: '右侧 Studio 产物应当复用同一套 grounded context，避免 PPT、报告、播客和知识卡片各自拼接资料造成引用不一致。',
        extra: '来源: studio-ui-smoke chunk-1',
      }],
      citations: [{ sourceId: 'studio-ui-smoke', chunkId: 'studio-ui-smoke-c1', snippet: '统一证据链', score: 1 }],
      retrieval: { mode: 'persisted-keyword', persistedSourceCount: 1, vectorIndexedSourceCount: 0 },
    }, 500, '/api/ai/knowledge-cards');
    await page.getByRole('button', { name: '生成知识卡片' }).click();
    await expectVisible(page.getByText('正在从选中资料中提取术语、论点和证据来源，请稍候。'), 'Knowledge-card loading copy did not render');
    await expectVisible(page.getByText('为什么要统一证据链？'), 'Knowledge-card result did not render');
    assert(knowledgeHits() >= 1, 'Knowledge-card generation request was not issued');

    await page.getByRole('button', { name: '音频播客' }).click();
    await expectVisible(page.getByRole('button', { name: '生成播客对话' }), 'Podcast generate button did not become available after source selection');
    const podcastHits = await interceptLongTask(page, '/api/ai/podcast', '/api/ai/podcast');
    await page.getByRole('button', { name: '生成播客对话' }).click();
    await expectVisible(page.getByText('播客生成可能需要较长时间，正在准备脚本、证据和音频任务。你可以取消后重新选择资料。'), 'Podcast long-task waiting copy did not render');
    await expectVisible(page.getByRole('button', { name: '取消生成' }).first(), 'Podcast cancel button did not render');
    await page.getByRole('button', { name: '取消生成' }).first().click();
    await expectVisible(page.getByText('已取消生成，可以调整资料后重新开始。'), 'Podcast cancel recovery copy did not render');
    assert(podcastHits() >= 1, 'Podcast generation request was not issued');

    console.log(JSON.stringify({
      ok: true,
      appOrigin,
      managedApp: smokeApp.managed,
      checked: [
        'Workbench loads Studio panel',
        'PPT no-source guard is visible and disabled',
        'Academic report no-source guard is visible and disabled',
        'Studio prompt enters the central chat when no source is selected',
        'UI upload auto-selects source',
        'Studio tab prompt enters central chat with selected source and configured model settings',
        'PPT generate button becomes available after source selection',
        'PPT request carries selected paper payload and configured model settings',
        'PPT long-task copy, cancel action, and recovery copy work',
        'Academic report request carries selected paper payload and configured model settings',
        'Academic report staged progress, cancel action, and recovery copy work',
        'Knowledge-card no-source guard is visible and disabled',
        'Knowledge-card generate button becomes available after source selection',
        'Knowledge-card request carries selected paper payload, configured model settings, citations, and retrieval metadata',
        'Knowledge-card loading copy and result render',
        'Podcast no-source guard is visible and disabled',
        'Podcast generate button becomes available after source selection',
        'Podcast request carries selected paper payload and configured model settings',
        'Podcast long-task copy, cancel action, and recovery copy work',
      ],
      requests: {
        chat: chatHits(),
        ppt: pptHits(),
        pptV2: pptV2Hits(),
        knowledgeCards: knowledgeHits(),
        podcast: podcastHits(),
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
