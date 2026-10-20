import axios from 'axios';
import { createLogger } from './logger';

const logger = createLogger('Retry');

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parses a `Retry-After` header value into milliseconds. The header may be
 * either a number of seconds (e.g. "5") or an HTTP date. Returns null when the
 * header is absent or unparseable.
 */
export function parseRetryAfter(header: string | undefined): number | null {
  if (!header) return null;

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

/**
 * Determines whether an error is worth retrying: network errors (no response)
 * and transient server responses (429 rate limits, 5xx). Client errors like
 * 400/401/403/404 are surfaced immediately.
 */
export function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;

  const status = error.response?.status;
  if (status === undefined) return true; // network error / timeout
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Executes an async request, retrying transient failures with exponential
 * backoff. When the response carries a `Retry-After` header (as HubSpot's
 * Journal API does on 429s), that value is honored instead of the computed
 * backoff. Non-retryable errors are rethrown immediately.
 */
export async function requestWithRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (!isRetryable(error) || attempt >= maxRetries) {
        throw error;
      }

      const retryAfterMs = axios.isAxiosError(error)
        ? parseRetryAfter(error.response?.headers?.['retry-after'] as string | undefined)
        : null;

      // Exponential backoff with full jitter, capped at maxDelayMs. Prefer the
      // server-provided Retry-After when present.
      const backoffMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitterMs = Math.random() * baseDelayMs;
      const delayMs = retryAfterMs ?? backoffMs + jitterMs;

      attempt += 1;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      logger.warn(
        `Request failed (status=${status ?? 'network'}), retrying in ${Math.round(delayMs)}ms ` +
          `(attempt ${attempt}/${maxRetries})`
      );
      await sleep(delayMs);
    }
  }
}
