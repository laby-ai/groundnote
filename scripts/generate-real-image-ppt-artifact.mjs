import './lib/load-real-env.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import pptxgen from 'pptxgenjs';

const startupTimeoutMs = Number(process.env.REAL_IMAGE_PPT_STARTUP_TIMEOUT_MS || 45_000);
const requestTimeoutMs = Number(process.env.REAL_IMAGE_PPT_TIMEOUT_MS || 600_000);

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
        if (!address || typeof address === 'string') reject(new Error('Unable to allocate image PPT smoke port.'));
        else resolve(address.port);
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
      throw new Error(`Image PPT app exited before health completed with code ${child.exitCode}.`);
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

async function startApp(tempDir) {
  if (process.env.REAL_IMAGE_PPT_ORIGIN) {
    return { origin: process.env.REAL_IMAGE_PPT_ORIGIN.replace(/\/$/, ''), child: null, output: [], external: true };
  }
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_RUNTIME_ENV: process.env.REAL_IMAGE_PPT_RUNTIME_ENV || 'production',
      NODE_ENV: process.env.REAL_IMAGE_PPT_RUNTIME_ENV || 'production',
      FILE_STORAGE_ADAPTER: process.env.FILE_STORAGE_ADAPTER || 'local',
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
      SOURCE_STORE_PATH: path.join(tempDir, 'sources.json'),
      ZVEC_STORE_PATH: path.join(tempDir, 'zvec'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  return { origin, child, output, external: false };
}

async function parseSse(response) {
  const text = await response.text();
  return text
    .split(/\n\n+/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => block.replace(/^data:\s*/m, ''))
    .map(raw => {
      try { return JSON.parse(raw); } catch { return { parseError: raw.slice(0, 500) }; }
    });
}

async function writeImagePptx(slides, outputPath) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Lingbi Studio';
  pptx.subject = 'Image PPT smoke artifact';
  pptx.title = slides[0]?.title || 'Image PPT';
  for (const item of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: '0B1020' };
    if (!item.imageUrl) throw new Error(`Slide "${item.title}" has no generated image.`);
    slide.addImage({ data: item.imageUrl, x: 0, y: 0, w: 13.333, h: 7.5 });
  }
  await pptx.writeFile({ fileName: outputPath });
}

async function main() {
  const imageConfig = {
    imageBase: envFirst('OPENAI_COMPAT_IMAGE_API_BASE', 'ARK_IMAGE_API_BASE', 'ARK_API_BASE'),
    imageKey: envFirst('OPENAI_COMPAT_IMAGE_API_KEY', 'ARK_IMAGE_API_KEY', 'ARK_AGENTPLAN_API_KEY', 'ARK_API_KEY'),
    imageModel: envFirst('OPENAI_COMPAT_IMAGE_MODEL', 'ARK_IMAGE_MODEL') || 'doubao-seedream-5-0-lite-260128',
  };
  const missing = [
    imageConfig.imageBase ? '' : 'OPENAI_COMPAT_IMAGE_API_BASE, ARK_IMAGE_API_BASE, or ARK_API_BASE',
    imageConfig.imageKey ? '' : 'OPENAI_COMPAT_IMAGE_API_KEY, ARK_IMAGE_API_KEY, ARK_AGENTPLAN_API_KEY, or ARK_API_KEY',
    imageConfig.imageModel ? '' : 'OPENAI_COMPAT_IMAGE_MODEL or ARK_IMAGE_MODEL',
  ].filter(Boolean);
  if (missing.length) {
    console.log(JSON.stringify({ ok: true, skipped: true, realService: false, missing }, null, 2));
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-real-image-ppt-'));
  const evidenceDir = path.resolve('.deploy/evidence');
  await mkdir(evidenceDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(evidenceDir, `real-image-ppt-${stamp}.pptx`);
  const summaryPath = path.join(evidenceDir, `real-image-ppt-summary-${stamp}.json`);
  const { origin, child, output, external } = await startApp(tempDir);
  const startedAt = Date.now();

  try {
    const health = await waitForHealth(origin, child);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const response = await fetch(`${origin}/api/ai/ppt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        papers: [{
          id: 'real-image-ppt-source',
          title: '资料工作台视觉简报验收',
          authors: ['Lingbi Studio'],
          year: new Date().getFullYear(),
          abstract: '验证图像 PPT 能够基于资料生成真实图片页并导出 PPTX。',
          rawContent: [
            '资料工作台需要把来源、引用问答、Studio 产物和长任务结果串成闭环。',
            '图像 PPT 适合生成视觉简报，要求每页是真实图片，完成后能导出可打开的 PPTX。',
            '本次验收只生成一页，重点验证图片模型鉴权、图片返回和 PPTX 打包链路。',
          ].join('\n'),
          fileType: 'txt',
        }],
        style: process.env.REAL_IMAGE_PPT_STYLE || 'tech-modern',
        pageCount: Number(process.env.REAL_IMAGE_PPT_PAGES || '1'),
        detailLevel: 'concise',
        language: 'zh',
        aspectRatio: '16:9',
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const events = await parseSse(response);
    const final = [...events].reverse().find(event => event.stage === 'done' || event.stage === 'error');
    if (!response.ok || final?.stage === 'error') {
      throw new Error(`Image PPT generation failed: HTTP ${response.status}; final=${JSON.stringify(final)}`);
    }
    const slides = final?.slides || [];
    const imageCount = slides.filter(slide => typeof slide.imageUrl === 'string' && slide.imageUrl.startsWith('data:image/')).length;
    if (slides.length === 0 || imageCount !== slides.length) {
      throw new Error(`Image PPT did not return image slides: slides=${slides.length}, images=${imageCount}`);
    }
    await writeImagePptx(slides, outputPath);
    const stats = await stat(outputPath);
    const summary = {
      ok: true,
      realService: true,
      origin,
      externalOrigin: external,
      durationMs: Date.now() - startedAt,
      health: { service: health.service },
      outputPath,
      bytes: stats.size,
      slideCount: slides.length,
      imageCount,
      stageMessages: events
        .filter(event => event.stage)
        .map(event => ({
          stage: event.stage,
          status: event.status,
          message: event.message,
          imageCompleted: event.imageCompleted,
          imageTotal: event.imageTotal,
        })),
      retrieval: final.retrieval,
      citationCount: final.citations?.length || 0,
    };
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const recentOutput = output.join('').slice(-3000);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${recentOutput ? `\nRecent server output:\n${recentOutput}` : ''}`);
  } finally {
    if (!external) killProcessTree(child);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
