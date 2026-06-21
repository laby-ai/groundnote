import assert from 'node:assert/strict';
import http from 'node:http';
import { GET as podcastGet } from '../src/app/api/ai/podcast/route';
import { NextRequest } from 'next/server';

const originalTemplate = process.env.PODCAST_STATUS_URL_TEMPLATE;
const mutableEnv = process.env as Record<string, string | undefined>;

function jsonGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

async function readJson(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function startStatusServer() {
  let hitCount = 0;
  const server = http.createServer((req, res) => {
    hitCount += 1;
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const taskId = url.pathname.split('/').filter(Boolean).pop();
    res.setHeader('Content-Type', 'application/json');

    if (taskId === 'done-task') {
      res.end(JSON.stringify({
        data: {
          status: 'completed',
          content: { podcast_url: 'https://cdn.example.com/podcast-done.mp3' },
          message: '播客音频已生成。',
        },
      }));
      return;
    }

    if (taskId === 'failed-task') {
      res.end(JSON.stringify({
        data: {
          status: 'failed',
          error_message: '上游音频合成失败',
        },
      }));
      return;
    }

    res.end(JSON.stringify({ data: { status: 'running', message: '播客仍在生成中。' } }));
  });

  return new Promise<{
    origin: string;
    getHitCount: () => number;
    close: () => Promise<void>;
  }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate podcast status mock port.'));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        getHitCount: () => hitCount,
        close: () => new Promise(closeResolve => server.close(() => closeResolve())),
      });
    });
  });
}

async function main() {
  const missing = await podcastGet(jsonGet('http://localhost/api/ai/podcast'));
  assert.equal(missing.status, 400);
  assert.match(String((await readJson(missing)).error), /taskId/);

  delete mutableEnv.PODCAST_STATUS_URL_TEMPLATE;
  const fallback = await podcastGet(jsonGet('http://localhost/api/ai/podcast?taskId=fallback-task'));
  assert.equal(fallback.status, 200);
  const fallbackJson = await readJson(fallback);
  assert.equal(fallbackJson.status, 'running');
  assert.equal(fallbackJson.provider, 'not_configured');
  assert.match(String(fallbackJson.message), /尚未配置|继续轮询/);

  const statusServer = await startStatusServer();
  try {
    mutableEnv.PODCAST_STATUS_URL_TEMPLATE = `${statusServer.origin}/tasks/{taskId}`;

    const completed = await podcastGet(jsonGet('http://localhost/api/ai/podcast?taskId=done-task'));
    assert.equal(completed.status, 200);
    const completedJson = await readJson(completed);
    assert.equal(completedJson.status, 'completed');
    assert.equal(completedJson.audioUrl, 'https://cdn.example.com/podcast-done.mp3');
    assert.equal(completedJson.provider, 'status-url-template');

    const failed = await podcastGet(jsonGet('http://localhost/api/ai/podcast?taskId=failed-task'));
    assert.equal(failed.status, 200);
    const failedJson = await readJson(failed);
    assert.equal(failedJson.status, 'failed');
    assert.match(String(failedJson.error), /上游音频合成失败/);

    assert.equal(statusServer.getHitCount(), 2);
  } finally {
    await statusServer.close();
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'podcast status GET rejects missing taskId',
      'podcast status GET returns running fallback without a configured status template',
      'podcast status template maps completed audioUrl',
      'podcast status template maps failed error',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}).finally(() => {
  if (originalTemplate === undefined) delete mutableEnv.PODCAST_STATUS_URL_TEMPLATE;
  else mutableEnv.PODCAST_STATUS_URL_TEMPLATE = originalTemplate;
});
