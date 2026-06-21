import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const origin = process.env.WORKBENCH_ORIGIN || 'http://127.0.0.1:5014';
const classroomOrigin = process.env.NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN || 'http://127.0.0.1:5025';
const outDir = path.resolve('output', 'playwright');
const bannedShellText = /\bOpenMAIC\b|\bMAIC\b|OpenSpeech|Coze/;
const bannedEmbeddedFrameText = /\bOpenMAIC\b|\bMAIC\b|OpenSpeech|Coze|\bCN\b|Settings|settings|模型|配置|Provider|Model/i;

async function openClassroom(page) {
  await page.goto(`${origin}/?qa=${Date.now()}#workbench`, { waitUntil: 'networkidle' });
  const firstSource = page.locator('[data-testid^="library-paper-"]').first();
  const sourceText = (await firstSource.textContent()).replace(/\s+/g, ' ').trim();
  await firstSource.click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="studio-nav-virtual-classroom"]').click();
  await page.waitForSelector('[data-testid="virtual-classroom-panel"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="virtual-classroom-iframe"]', { timeout: 20_000 });
  return sourceText;
}

async function waitForClassroomFrame(page) {
  await page.waitForFunction(
    expectedOrigin => Array.from(document.querySelectorAll('iframe'))
      .some(frame => frame.src.startsWith(expectedOrigin)),
    classroomOrigin,
    { timeout: 20_000 },
  );
  const frame = page.frame({ url: url => url.href.startsWith(classroomOrigin) });
  if (!frame) return null;
  await frame.locator('body').waitFor({ timeout: 20_000 }).catch(() => undefined);
  await frame.waitForFunction(
    () => {
      const text = document.body?.innerText || '';
      return text.trim().length > 20 && !/^Loading classroom\.\.\.$/.test(text.trim());
    },
    undefined,
    { timeout: 20_000 },
  ).catch(() => undefined);
  return frame;
}

async function runTheme(browser, theme) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`pageerror:${error.message}`));

  await page.goto(`${origin}/#workbench`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(nextTheme => {
    localStorage.setItem('theme', nextTheme);
    localStorage.setItem('lingbi-theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  }, theme);

  const sourceText = await openClassroom(page);
  const iframe = page.locator('[data-testid="virtual-classroom-iframe"]');
  const frameSrc = await iframe.getAttribute('src');
  const initialIframeCount = await iframe.count();
  const statusResponse = await page.request.get(`${origin}/api/virtual-classroom/status`);
  const statusJson = await statusResponse.json().catch(() => ({ recentClassrooms: [] }));
  const recentCount = Array.isArray(statusJson.recentClassrooms) ? statusJson.recentClassrooms.length : 0;
  const shellText = await page.locator('[data-testid="virtual-classroom-workspace"]').textContent();
  const workspaceTitle = await page.locator('[data-testid="virtual-classroom-workspace-title"]').textContent().catch(() => '');
  const activeStatusText = await page.locator('[data-testid="virtual-classroom-active-status"]').textContent().catch(() => '');
  const returnOpenedCount = await page.locator('[data-testid="virtual-classroom-return-opened"]').count();
  const frame = await waitForClassroomFrame(page);
  const frameText = frame ? (await frame.locator('body').innerText({ timeout: 20_000 }).catch(() => '')) : '';
  if (frame) {
    await frame.waitForFunction(
      () => document.querySelector('textarea')?.value.includes('请基于以下资料创建一节虚拟课堂'),
      undefined,
      { timeout: 20_000 },
    ).catch(() => undefined);
  }
  const requirementValue = frame
    ? await frame.locator('textarea').first().inputValue({ timeout: 20_000 }).catch(() => '')
    : '';

  let recentOpenCount = 0;
  let recentExportCount = 0;
  let recentOpenFrameSrc = '';
  let recentOpenFrameLoaded = false;
  let recentOpenFrameEmbedMode = false;
  let recentOpenInternalConfigHidden = false;
  let recentCurrentBadgeCount = 0;
  let confirmedFrameSrc = '';
  let confirmedFrameLoaded = false;
  let confirmedFrameEmbedMode = false;
  let confirmedInternalConfigHidden = false;
  let confirmedUsesRuntime = false;
  let confirmedDraftPassed = false;
  let runtimeStatusReady = false;
  let outlineResultReady = false;
  if (recentCount > 0) {
    await page.locator('[data-testid="virtual-classroom-close-workspace"]').click();
    await page.waitForSelector('[data-testid="virtual-classroom-panel"]', { timeout: 10_000 });
    recentOpenCount = await page.locator('[data-testid^="virtual-classroom-recent-open-"]').count();
    recentExportCount = await page.locator('[data-testid^="virtual-classroom-recent-export-"]').count();
    await page.locator('[data-testid^="virtual-classroom-recent-open-"]').first().click();
    await page.waitForSelector('[data-testid="virtual-classroom-iframe"]', { timeout: 10_000 });
    recentOpenFrameSrc = await page.locator('[data-testid="virtual-classroom-iframe"]').getAttribute('src') || '';
    recentOpenFrameEmbedMode = recentOpenFrameSrc.includes('embed=lingbi');
    const recentFrame = await waitForClassroomFrame(page);
    const recentText = recentFrame ? await recentFrame.locator('body').innerText({ timeout: 20_000 }).catch(() => '') : '';
    recentOpenFrameLoaded = Boolean(
      recentText &&
      recentText.trim().length > 20 &&
      !/^Loading classroom\.\.\.$/.test(recentText.trim()),
    );
    recentOpenInternalConfigHidden = Boolean(recentText) && !bannedEmbeddedFrameText.test(recentText);
    recentCurrentBadgeCount = await page.locator('[data-testid^="virtual-classroom-recent-current-"]').count();
  }

  if (await page.locator('[data-testid="virtual-classroom-close-workspace"]').count()) {
    await page.locator('[data-testid="virtual-classroom-close-workspace"]').click();
  }
  await page.waitForSelector('[data-testid="virtual-classroom-panel"]', { timeout: 10_000 });
  await page.locator('[data-testid="virtual-classroom-generate-outline"]').click();
  await page.waitForSelector('[data-testid="virtual-classroom-outline-result"]', { timeout: 15_000 });
  const outlineText = await page.locator('[data-testid="virtual-classroom-outline-result"]').textContent().catch(() => '');
  outlineResultReady = /待确认大纲/.test(outlineText || '') && /场景/.test(outlineText || '') && /动作/.test(outlineText || '');
  await page.locator('[data-testid="virtual-classroom-confirm-outline"]').click();
  await page.waitForSelector('[data-testid="virtual-classroom-iframe"]', { timeout: 15_000 });
  confirmedFrameSrc = await page.locator('[data-testid="virtual-classroom-iframe"]').getAttribute('src') || '';
  confirmedFrameEmbedMode = confirmedFrameSrc.includes('embed=lingbi');
  const confirmedFrame = await waitForClassroomFrame(page);
  const confirmedFrameText = confirmedFrame ? await confirmedFrame.locator('body').innerText({ timeout: 20_000 }).catch(() => '') : '';
  confirmedFrameLoaded = Boolean(
    confirmedFrameText &&
    confirmedFrameText.trim().length > 20 &&
    !/^Loading classroom\.\.\.$/.test(confirmedFrameText.trim()),
  );
  confirmedInternalConfigHidden = Boolean(confirmedFrameText) && !bannedEmbeddedFrameText.test(confirmedFrameText);
  confirmedUsesRuntime = confirmedFrameSrc.startsWith(classroomOrigin) &&
    !confirmedFrameSrc.includes('/virtual-classroom/preview/');
  const confirmedRequirementValue = confirmedFrame
    ? await confirmedFrame.locator('textarea').first().inputValue({ timeout: 20_000 }).catch(() => '')
    : '';
  confirmedDraftPassed = /请生成一节完整虚拟课堂/.test(confirmedRequirementValue) &&
    /已确认课程大纲/.test(confirmedRequirementValue);
  const runtimeStatusText = await page.locator('[data-testid="virtual-classroom-runtime-confirmed-status"]')
    .textContent({ timeout: 10_000 })
    .catch(() => '');
  runtimeStatusReady = /已送入完整课堂/.test(runtimeStatusText || '') &&
    /中间工作区已打开课堂运行时/.test(runtimeStatusText || '');

  const result = {
    theme,
    url: page.url(),
    frameSrc,
    frameEmbedMode: Boolean(frameSrc?.includes('embed=lingbi')),
    hasIframe: initialIframeCount,
    shellRawLeak: bannedShellText.test(shellText || ''),
    frameInternalConfigHidden: Boolean(frameText) && !bannedEmbeddedFrameText.test(frameText),
    activeStatusReady: /课堂已在中间工作区打开/.test(activeStatusText || '') && returnOpenedCount === 1,
    frameLoaded: Boolean(frameText && frameText.trim().length > 20),
    workspaceTitleReady: /虚拟教室|课堂|资料|场景|动作/.test(workspaceTitle || ''),
    frameHasClassroomUi: /生成|导入|课堂|设置|Enter|Upload|Generate|Import|Classroom/i.test(frameText || ''),
    draftPassed: Boolean(frameSrc?.includes('draft=')),
    requirementHasSourceContext: /请基于以下资料创建一节虚拟课堂/.test(requirementValue) &&
      requirementValue.includes(sourceText.slice(0, 12)),
    recentCount,
    recentOpenCount,
    recentExportCount,
    recentOpenFrameSrc,
    recentOpenFrameEmbedMode,
    recentOpenFrameLoaded,
    recentOpenInternalConfigHidden,
    recentCurrentBadgeCount,
    outlineResultReady,
    confirmedFrameSrc,
    confirmedFrameEmbedMode,
    confirmedFrameLoaded,
    confirmedInternalConfigHidden,
    confirmedUsesRuntime,
    confirmedDraftPassed,
    runtimeStatusReady,
    requirementPreview: requirementValue.slice(0, 120),
    errors,
    screenshot: path.join(outDir, `virtual-classroom-full-frontend-${theme}.png`),
  };

  await page.screenshot({ path: result.screenshot, fullPage: false });
  await page.close();
  return result;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const results = [
      await runTheme(browser, 'dark'),
      await runTheme(browser, 'light'),
    ];
    const ok = results.every(result =>
      result.url.includes('#workbench') &&
      result.hasIframe === 1 &&
      result.frameSrc?.startsWith(classroomOrigin) &&
      result.frameEmbedMode &&
      result.activeStatusReady &&
      result.frameLoaded &&
      result.frameInternalConfigHidden &&
      result.workspaceTitleReady &&
      result.frameHasClassroomUi &&
      result.draftPassed &&
      result.requirementHasSourceContext &&
      result.outlineResultReady &&
      result.confirmedUsesRuntime &&
      result.confirmedFrameLoaded &&
      result.confirmedDraftPassed &&
      result.runtimeStatusReady &&
      (result.recentCount === 0 ||
        (result.recentOpenCount >= result.recentCount &&
          result.recentExportCount >= result.recentCount &&
          result.recentOpenFrameSrc.startsWith(`${classroomOrigin}/classroom/`) &&
          result.recentOpenFrameEmbedMode &&
          result.recentOpenFrameLoaded &&
          result.recentOpenInternalConfigHidden &&
          result.recentCurrentBadgeCount >= 1)) &&
      !result.shellRawLeak &&
      result.confirmedFrameEmbedMode &&
      result.confirmedInternalConfigHidden &&
      result.errors.length === 0,
    );
    console.log(JSON.stringify({ ok, origin, classroomOrigin, results }, null, 2));
    if (!ok) process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
