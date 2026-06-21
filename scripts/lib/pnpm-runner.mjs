import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function quoteShellArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function resolvePnpm() {
  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs') : '',
    process.env.PNPM_HOME ? path.join(process.env.PNPM_HOME, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs') : '',
  ].filter(Boolean);
  const pnpmCjs = candidates.find(candidate => existsSync(candidate));
  if (pnpmCjs) {
    return { command: process.execPath, prefixArgs: [pnpmCjs], shell: false };
  }
  return { command: 'pnpm', prefixArgs: [], shell: false };
}

export function runCommandSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    shell: options.shell || false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function runPnpmSync(args, options = {}) {
  const pnpm = resolvePnpm();
  if (process.platform === 'win32' && pnpm.command === 'pnpm') {
    runCommandSync(`pnpm ${args.map(quoteShellArg).join(' ')}`, [], { ...options, shell: true });
    return;
  }
  runCommandSync(pnpm.command, [...pnpm.prefixArgs, ...args], options);
}

export function spawnPnpm(args, options = {}) {
  const pnpm = resolvePnpm();
  if (process.platform === 'win32' && pnpm.command === 'pnpm') {
    return spawn(`pnpm ${args.map(quoteShellArg).join(' ')}`, [], {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: options.stdio || 'inherit',
      shell: true,
    });
  }
  return spawn(pnpm.command, [...pnpm.prefixArgs, ...args], {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    shell: false,
  });
}
