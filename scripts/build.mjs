import process from 'node:process';
import { runPnpmSync } from './lib/pnpm-runner.mjs';

const workspace = process.env.APP_WORKSPACE_PATH || process.cwd();

console.log('Installing dependencies...');
runPnpmSync(['install', '--prefer-frozen-lockfile', '--prefer-offline', '--loglevel', 'debug', '--reporter=append-only'], { cwd: workspace });

console.log('Building the Next.js project...');
runPnpmSync(['exec', 'next', 'build'], { cwd: workspace });

console.log('Bundling server with tsup...');
runPnpmSync(['exec', 'tsup', 'src/server.ts', '--format', 'cjs', '--platform', 'node', '--target', 'node20', '--outDir', 'dist', '--no-splitting', '--no-minify'], { cwd: workspace });

console.log('Build completed successfully!');
