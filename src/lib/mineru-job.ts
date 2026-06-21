export type MinerUJobErrorCategory =
  | 'not_configured'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'network'
  | 'unknown';

export interface MinerUJobOptions {
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface MinerUJobFailure {
  category: MinerUJobErrorCategory;
  retryable: boolean;
  message: string;
  status?: number;
  timedOut?: boolean;
}

const DEFAULT_MINERU_JOB_TIMEOUT_MS = 180_000;
const DEFAULT_MINERU_JOB_MAX_RETRIES = 1;
const DEFAULT_MINERU_JOB_RETRY_DELAY_MS = 3_000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function mineruJobOptionsFromEnv(): MinerUJobOptions {
  return {
    timeoutMs: readPositiveIntEnv('MINERU_JOB_TIMEOUT_MS', DEFAULT_MINERU_JOB_TIMEOUT_MS),
    maxRetries: readPositiveIntEnv('MINERU_JOB_MAX_RETRIES', DEFAULT_MINERU_JOB_MAX_RETRIES),
    retryDelayMs: readPositiveIntEnv('MINERU_JOB_RETRY_DELAY_MS', DEFAULT_MINERU_JOB_RETRY_DELAY_MS),
  };
}

export function mineruJobHealth() {
  return {
    configured: Boolean(process.env.MINERU_API_TOKEN?.trim()),
    ...mineruJobOptionsFromEnv(),
  };
}

export function classifyMinerUJobFailure(input: {
  status?: number;
  message?: string;
  timedOut?: boolean;
}): MinerUJobFailure {
  const message = input.message || 'MinerU job failed';

  if (input.timedOut) {
    return {
      category: 'timeout',
      retryable: true,
      message,
      status: input.status,
      timedOut: true,
    };
  }

  if (input.status === 401 || input.status === 403) {
    return {
      category: 'auth',
      retryable: false,
      message,
      status: input.status,
    };
  }

  if (input.status === 429) {
    return {
      category: 'rate_limit',
      retryable: true,
      message,
      status: input.status,
    };
  }

  if (input.status && input.status >= 500) {
    return {
      category: 'upstream',
      retryable: true,
      message,
      status: input.status,
    };
  }

  if (/fetch failed|network|econnreset|enotfound|etimedout/i.test(message)) {
    return {
      category: 'network',
      retryable: true,
      message,
      status: input.status,
    };
  }

  return {
    category: 'unknown',
    retryable: false,
    message,
    status: input.status,
  };
}

export function mineruJobErrorMessage(failure: MinerUJobFailure, attempt: number): string {
  const status = typeof failure.status === 'number' ? ` status=${failure.status}` : '';
  const timedOut = failure.timedOut ? ' timeout=true' : '';
  return `MinerU ${failure.category}${status}${timedOut} attempt=${attempt}: ${failure.message}`;
}
