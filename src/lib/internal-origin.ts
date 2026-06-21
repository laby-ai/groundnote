const DEFAULT_INTERNAL_PORT = '5000';

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('INTERNAL_APP_ORIGIN must use http or https.');
  }
  return url.origin;
}

export function resolveInternalAppOrigin(): string {
  const explicitOrigin = process.env.INTERNAL_APP_ORIGIN?.trim();
  if (explicitOrigin) {
    return normalizeOrigin(explicitOrigin);
  }

  const port = process.env.DEPLOY_RUN_PORT || process.env.PORT || DEFAULT_INTERNAL_PORT;
  return `http://localhost:${port}`;
}
