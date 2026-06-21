import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const envPath = path.resolve('.env.real.local');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: true });

const baseUrl = process.env.OPENMAIC_SIDECAR_URL || 'http://127.0.0.1:5025';
const expectedProvider = process.env.OPENMAIC_EXPECTED_PROVIDER || 'glm';
const expectedModel =
  process.env.OPENMAIC_EXPECTED_MODEL ||
  process.env.ARK_AGENTPLAN_TEXT_MODEL ||
  process.env.ARK_MODEL ||
  'glm-5.2';
const verifyModel = process.env.OPENMAIC_VERIFY_MODEL === '1';
const outDir = path.resolve('output', 'openmaic');

function evidenceName(status) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(outDir, `provider-bridge-${stamp}-${status}.json`);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /key|token|secret|password|credential/i.test(key) ? '[redacted]' : redact(item),
    ]));
  }
  if (typeof value === 'string' && /^(ark|sk)-[A-Za-z0-9-]{12,}/.test(value)) return '[redacted]';
  return value;
}

function containsSecret(value) {
  return /"(?:apiKey|token|secret|password|credential)"\s*:\s*"(?!\[redacted\])[^"]+|(?:ark|sk)-[A-Za-z0-9-]{20,}/i
    .test(JSON.stringify(value));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const record = {
    baseUrl,
    expectedProvider,
    expectedModel,
    verifyModel,
    checks: {},
  };

  const providersResponse = await fetch(`${baseUrl}/api/server-providers`);
  const providersJson = await readJson(providersResponse);
  const providers = providersJson.providers || {};
  const provider = providers[expectedProvider];
  const providerModels = Array.isArray(provider?.models) ? provider.models : [];
  const videoProviders = providersJson.video || {};

  record.providersStatus = providersResponse.status;
  record.providers = redact(providersJson);
  record.checks.expectedProviderPresent = Boolean(provider);
  record.checks.expectedModelPresent = providerModels.includes(expectedModel);
  record.checks.videoDisabled = Object.keys(videoProviders).length === 0;
  record.checks.noSecretLeak = !containsSecret(providersJson);

  if (verifyModel) {
    const verifyResponse = await fetch(`${baseUrl}/api/verify-model`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: `${expectedProvider}:${expectedModel}` }),
    });
    const verifyJson = await readJson(verifyResponse);
    record.verifyStatus = verifyResponse.status;
    record.verify = redact(verifyJson);
    record.checks.verifySucceeded =
      verifyResponse.ok &&
      (verifyJson.success === true || verifyJson.data?.message === 'Connection successful') &&
      !containsSecret(verifyJson);
  }

  const ok = Object.values(record.checks).every(Boolean);
  const file = evidenceName(ok ? 'succeeded' : 'failed');
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({
    ok,
    baseUrl,
    expectedProvider,
    expectedModel,
    checks: record.checks,
    evidence: file,
  }, null, 2));
  if (!ok) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
