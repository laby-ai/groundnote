import { spawnSync } from 'node:child_process';
import process from 'node:process';
import './lib/load-real-env.mjs';

const workspace = process.env.APP_WORKSPACE_PATH || process.cwd();
const port = process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000';
const runtimeEnv = process.env.APP_RUNTIME_ENV || process.env.NODE_ENV || 'production';

console.log(`Starting HTTP service on port ${port} for deploy...`);

const result = spawnSync(process.execPath, ['dist/server.js'], {
  cwd: workspace,
  env: {
    ...process.env,
    APP_RUNTIME_ENV: runtimeEnv,
    NODE_ENV: runtimeEnv,
    PORT: port,
  },
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
