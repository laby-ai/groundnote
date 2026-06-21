import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const deployDir = path.join(repoRoot, '.deploy');
const image = process.env.LINUX_CLEANROOM_IMAGE || 'node:20-bookworm-slim';
const timeoutMs = Number(process.env.LINUX_CLEANROOM_TIMEOUT_MS || 420_000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findLatestArchive() {
  const files = fs.existsSync(deployDir)
    ? fs.readdirSync(deployDir)
        .filter(name => /^lingbi-studio-linux-.*\.tar\.gz$/i.test(name))
        .map(name => path.join(deployDir, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  assert(files.length > 0, 'No Linux package found. Run pnpm package:linux first.');
  return files[0];
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: options.timeout ?? timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
  });
}

function dockerAvailable() {
  const result = run('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 30_000 });
  return {
    ok: result.status === 0,
    version: result.stdout.trim(),
    error: result.stderr.trim() || result.error?.message || '',
  };
}

function powershellPathToDockerMount(value) {
  return value.replaceAll('\\', '/');
}

function main() {
  const docker = dockerAvailable();
  assert(docker.ok, `Docker is not available: ${docker.error || 'unknown error'}`);

  const archive = findLatestArchive();
  const archiveName = path.basename(archive);
  const archiveDir = path.dirname(archive);
  const start = Date.now();
  const script = [
    'set -euo pipefail',
    'echo cleanroom_kernel=$(uname -srm)',
    'echo cleanroom_node=$(node -v)',
    'if ! command -v curl >/dev/null 2>&1; then apt-get update >/tmp/apt-update.log && apt-get install -y --no-install-recommends curl ca-certificates >/tmp/apt-install.log; fi',
    'corepack enable >/tmp/corepack-enable.log 2>&1 || true',
    'corepack prepare pnpm@9.0.0 --activate >/tmp/corepack-prepare.log 2>&1 || npm install -g pnpm@9 >/tmp/npm-pnpm-install.log 2>&1',
    'echo cleanroom_pnpm=$(pnpm -v)',
    'mkdir -p /tmp/lingbi-cleanroom',
    'tar -xzf "/bundle/' + archiveName.replaceAll('"', '\\"') + '" -C /tmp/lingbi-cleanroom',
    'cd /tmp/lingbi-cleanroom/*/lingbi-studio',
    'echo app_dir=$(pwd)',
    'PORT=57891 DEPLOY_RUN_PORT=57891 bash ./deploy.sh',
    'pid="$(cat logs/server.pid)"',
    'echo server_pid=$pid',
    'if ! PORT=57891 bash ./healthcheck.sh; then echo "--- server log ---"; tail -n 120 logs/server.log; kill "$pid" || true; exit 1; fi',
    'node -e "fetch(\'http://127.0.0.1:57891/api/health\').then(r=>r.json()).then(b=>{if(!b.ok||b.service!==\'lingbi-studio\') process.exit(1); console.log(JSON.stringify({service:b.service,sourceStore:b.capabilities?.sourceStore,vectorStore:b.capabilities?.vectorStore,limits:b.limits}, null, 2));})"',
    'kill "$pid"',
  ].join('\n');

  const result = run('docker', [
    'run',
    '--rm',
    '--network',
    'bridge',
    '-v',
    `${powershellPathToDockerMount(archiveDir)}:/bundle:ro`,
    image,
    'bash',
    '-lc',
    script,
  ]);

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const ok = result.status === 0;
  console.log(JSON.stringify({
    ok,
    realLinux: true,
    container: 'docker',
    image,
    dockerVersion: docker.version,
    archive,
    archiveBytes: fs.statSync(archive).size,
    durationMs: Date.now() - start,
    checked: [
      'latest Linux tarball extracted inside a clean Node Linux container',
      'package deploy.sh handles missing execute bits and installs production dependencies without source workspace node_modules',
      'package deploy.sh runs preflight inside Linux',
      'package deploy.sh boots the production server',
      'package healthcheck.sh reaches /api/health',
      '/api/health exposes source store, zvec vector store, and upload limits',
    ],
    outputTail: output.slice(-6000),
  }, null, 2));

  if (!ok) process.exit(result.status || 1);
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    realLinux: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}
