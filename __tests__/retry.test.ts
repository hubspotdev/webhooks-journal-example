import { requestWithRetry, parseRetryAfter, isRetryable } from '../src/utils/retry';

interface FakeAxiosError {
  isAxiosError: true;
  message: string;
  response?: { status: number; headers?: Record<string, string> };
}

function axiosError(status?: number, headers?: Record<string, string>): FakeAxiosError {
  return {
    isAxiosError: true,
    message: 'boom',
    response: status === undefined ? undefined : { status, headers },
  };
}

const fastOptions = { baseDelayMs: 1, maxDelayMs: 2 };

describe('parseRetryAfter', () => {
  it('parses a delay expressed in seconds', () => {
    expect(parseRetryAfter('2')).toBe(2000);
  });

  it('returns null when the header is missing', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it('parses an HTTP date into a positive delay', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const delay = parseRetryAfter(future);
    expect(delay).not.toBeNull();
    expect(delay!).toBeGreaterThan(3000);
  });
});

describe('isRetryable', () => {
  it('retries 429 and 5xx responses', () => {
    expect(isRetryable(axiosError(429))).toBe(true);
    expect(isRetryable(axiosError(503))).toBe(true);
  });

  it('retries network errors with no response', () => {
    expect(isRetryable(axiosError(undefined))).toBe(true);
  });

  it('does not retry 4xx client errors', () => {
    expect(isRetryable(axiosError(400))).toBe(false);
    expect(isRetryable(axiosError(404))).toBe(false);
  });
});

describe('requestWithRetry', () => {
  it('retries transient failures then resolves', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 3) throw axiosError(503);
      return 'ok';
    });

    await expect(requestWithRetry(fn, { ...fastOptions, maxRetries: 5 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honors the Retry-After header when present', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 2) throw axiosError(429, { 'retry-after': '0' });
      return 'ok';
    });

    await expect(requestWithRetry(fn, { ...fastOptions, maxRetries: 3 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and rethrows', async () => {
    const fn = jest.fn(async () => {
      throw axiosError(503);
    });

    await expect(requestWithRetry(fn, { ...fastOptions, maxRetries: 2 })).rejects.toMatchObject({
      response: { status: 503 },
    });
    // initial attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = jest.fn(async () => {
      throw axiosError(400);
    });

    await expect(requestWithRetry(fn, fastOptions)).rejects.toMatchObject({
      response: { status: 400 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
