import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const origin = process.env.WORKBENCH_ORIGIN || 'http://127.0.0.1:5014';
const outDir = path.resolve('output', 'playwright');
const bannedUserFacingText = /Graphify|Hyper-Extract|OpenMAIC|MAIC|Karpathy|\bwiki\b|vis-network|模型推断/i;

async function main() {
  await mkdir(outDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const screenshotPath = path.join(outDir, `knowledge-map-ui-${runId}.png`);
  const evidencePath = path.join(outDir, `knowledge-map-ui-${runId}.json`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  try {
    await page.goto(`${origin}/#workbench`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('[data-testid^="library-paper-"]', { timeout: 45_000 });

    if (await page.locator('[data-testid="library-selection-count"]').count() === 0) {
      await page.locator('[data-testid^="library-paper-"]').first().click();
      await page.waitForSelector('[data-testid="library-selection-count"]', { timeout: 10_000 });
    }

    await page.getByTestId('studio-nav-knowledge').click();
    await page.waitForSelector('[data-testid="knowledge-map-panel"]', { timeout: 10_000 });
    await page.getByTestId('knowledge-map-generate').click();
    await page.waitForSelector('[data-testid="knowledge-map-workspace"]', { timeout: 45_000 });
    await page.waitForSelector('[data-testid="knowledge-map-focal-node"]', { timeout: 10_000 });
    await page.waitForSelector('[data-testid="knowledge-map-selected-node"]', { timeout: 10_000 });

    const graphBox = await page.getByTestId('knowledge-map-graph').boundingBox();
    const detailText = await page.getByTestId('knowledge-map-detail').innerText();
    const focalCount = await page.locator('[data-testid="knowledge-map-focal-node"]').count();
    const nodeCount = await page.locator('[data-testid="knowledge-map-node"]').count() + focalCount;
    const edgeCount = await page.locator('[data-testid="knowledge-map-edge"]').count();
    const title = await page.getByTestId('knowledge-map-title').innerText();
    const selectedNode = await page.getByTestId('knowledge-map-selected-node').innerText();
    const bodyText = await page.locator('body').innerText();
    const userFacingLeak = bannedUserFacingText.test(bodyText);

    await page.screenshot({ path: screenshotPath, fullPage: true });

    const evidence = {
      ok: Boolean(
        graphBox &&
        graphBox.width > 650 &&
        graphBox.height > 400 &&
        focalCount === 1 &&
        nodeCount >= 4 &&
        edgeCount >= 2 &&
        detailText.includes('引用状态') &&
        !userFacingLeak &&
        consoleErrors.length === 0
      ),
      url: `${origin}/#workbench`,
      title,
      selectedNode,
      graphBox,
      focalCount,
      nodeCount,
      edgeCount,
      detailHasCitationState: detailText.includes('引用状态'),
      userFacingLeak,
      consoleErrors: consoleErrors.slice(0, 8),
      screenshotPath,
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
    if (!evidence.ok) process.exitCode = 1;
  } catch (error) {
    const evidence = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      screenshotPath,
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
