import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import process from 'node:process';

const workspace = process.env.APP_WORKSPACE_PATH || process.cwd();
const startupTimeoutMs = Number(process.env.DEV_HEALTH_SMOKE_TIMEOUT_MS || 30_000);

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
          reject(new Error('Unable to allocate a local dev smoke port.'));
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
    if (child.exitCode !== null) {
      throw new Error(`Dev server exited before health check completed with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok) return body;
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(`Timed out waiting for dev /api/health at ${origin}. Last error: ${lastError}`);
}

function killProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function main() {
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      DEPLOY_RUN_PORT: String(port),
      INTERNAL_APP_ORIGIN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));

  try {
    const body = await waitForHealth(origin, child);
    assert(body.ok === true, `/api/health returned not ok: ${JSON.stringify(body)}`);
    assert(body.runtime === 'development', `Expected development runtime, got ${body.runtime}`);
    assert(body.capabilities?.sourceStore?.provider, 'health response does not expose source store provider.');
    assert(['ilike', 'fts'].includes(body.capabilities?.sourceStore?.readyChunkSearch?.mode), 'health response does not expose ready chunk search mode.');
    assert(body.capabilities?.vectorStore?.provider === 'zvec', 'health response does not expose zvec vector store.');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'cross-platform dev wrapper',
        'dev server /api/health ok response',
        'development runtime health',
        'source store health',
        'ready chunk search mode health',
        'zvec vector store health',
      ],
      origin,
      runtime: body.runtime,
      sourceStore: body.capabilities.sourceStore,
      vectorStore: body.capabilities.vectorStore,
    }, null, 2));
  } catch (error) {
    const recentOutput = output.join('').slice(-4000);
    if (recentOutput) console.error(recentOutput);
    throw error;
  } finally {
    killProcessTree(child);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
