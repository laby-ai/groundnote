import assert from 'node:assert/strict';
import { classifyMinerUJobFailure, mineruJobHealth, mineruJobOptionsFromEnv } from '../src/lib/mineru-job';

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const defaultOptions = withEnv({
  MINERU_JOB_TIMEOUT_MS: undefined,
  MINERU_JOB_MAX_RETRIES: undefined,
  MINERU_JOB_RETRY_DELAY_MS: undefined,
}, () => mineruJobOptionsFromEnv());
assert.equal(defaultOptions.timeoutMs, 180_000);
assert.equal(defaultOptions.maxRetries, 1);
assert.equal(defaultOptions.retryDelayMs, 3_000);

const customOptions = withEnv({
  MINERU_JOB_TIMEOUT_MS: '12000',
  MINERU_JOB_MAX_RETRIES: '3',
  MINERU_JOB_RETRY_DELAY_MS: '250',
}, () => mineruJobOptionsFromEnv());
assert.deepEqual(customOptions, {
  timeoutMs: 12_000,
  maxRetries: 3,
  retryDelayMs: 250,
});

const timeout = classifyMinerUJobFailure({ timedOut: true, message: 'aborted' });
assert.equal(timeout.category, 'timeout');
assert.equal(timeout.retryable, true);

const auth = classifyMinerUJobFailure({ status: 401, message: 'unauthorized' });
assert.equal(auth.category, 'auth');
assert.equal(auth.retryable, false);

const rateLimit = classifyMinerUJobFailure({ status: 429, message: 'too many requests' });
assert.equal(rateLimit.category, 'rate_limit');
assert.equal(rateLimit.retryable, true);

const upstream = classifyMinerUJobFailure({ status: 503, message: 'bad gateway' });
assert.equal(upstream.category, 'upstream');
assert.equal(upstream.retryable, true);

const network = classifyMinerUJobFailure({ message: 'fetch failed: ECONNRESET' });
assert.equal(network.category, 'network');
assert.equal(network.retryable, true);

const health = withEnv({
  MINERU_API_TOKEN: 'test-token',
  MINERU_JOB_TIMEOUT_MS: '9000',
  MINERU_JOB_MAX_RETRIES: '2',
  MINERU_JOB_RETRY_DELAY_MS: '1000',
}, () => mineruJobHealth());
assert.deepEqual(health, {
  configured: true,
  timeoutMs: 9_000,
  maxRetries: 2,
  retryDelayMs: 1_000,
});

console.log(JSON.stringify({
  ok: true,
  checked: [
    'MinerU job default timeout and retry options',
    'MinerU job env overrides',
    'MinerU timeout/auth/rate-limit/upstream/network classification',
    'MinerU job health payload',
  ],
  defaults: defaultOptions,
  custom: customOptions,
  health,
}, null, 2));
