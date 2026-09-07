import { describe, expect, it, vi } from 'vitest';
import { isTransientError, retryUpdate } from '../../../src/bot/update-retry';

function transientErr(over: Partial<{ status: number; statusCode: number; code: number; message: string; name: string }> = {}) {
  const err: any = new Error(over.message ?? 'transient');
  if (over.status !== undefined) err.status = over.status;
  if (over.statusCode !== undefined) err.statusCode = over.statusCode;
  if (over.code !== undefined) err.code = over.code;
  if (over.name) err.name = over.name;
  return err;
}

describe('isTransientError', () => {
  it('treats 5xx as transient', () => {
    expect(isTransientError(transientErr({ status: 504 }))).toBe(true);
    expect(isTransientError(transientErr({ status: 500 }))).toBe(true);
    expect(isTransientError(transientErr({ status: 502 }))).toBe(true);
  });

  it('treats 408 request timeout as transient', () => {
    expect(isTransientError(transientErr({ status: 408 }))).toBe(true);
  });

  it('does NOT treat 4xx as transient', () => {
    expect(isTransientError(transientErr({ status: 400 }))).toBe(false);
    expect(isTransientError(transientErr({ status: 404 }))).toBe(false);
    expect(isTransientError(transientErr({ status: 429 }))).toBe(false);
  });

  it('treats network-level errors as transient', () => {
    expect(isTransientError(transientErr({ message: 'fetch failed', name: 'TypeError' }))).toBe(true);
    expect(isTransientError(transientErr({ message: 'socket hang up', code: -1 }))).toBe(true);
    expect(isTransientError(transientErr({ message: 'network timeout', name: 'TimeoutError' }))).toBe(true);
  });

  it('does NOT treat arbitrary errors as transient', () => {
    expect(isTransientError(new Error('something broke'))).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

describe('retryUpdate', () => {
  it('returns immediately on first success without retrying', async () => {
    const update = vi.fn().mockResolvedValue('ok');
    const onRetry = vi.fn();
    const result = await retryUpdate('card', 'scope-x', update, {
      maxAttempts: 4,
      sleepFn: async () => {},
      onRetry,
    });
    expect(result).toBe('ok');
    expect(update).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries on transient failure then succeeds', async () => {
    const delays: number[] = [];
    const update = vi
      .fn()
      .mockRejectedValueOnce(transientErr({ status: 504 }))
      .mockRejectedValueOnce(transientErr({ status: 504 }))
      .mockResolvedValueOnce('recovered');
    const onRetry = vi.fn();
    const result = await retryUpdate('card', 'scope-x', update, {
      maxAttempts: 4,
      baseDelayMs: 100,
      factor: 2,
      sleepFn: async (ms) => {
        delays.push(ms);
      },
      onRetry,
    });
    expect(result).toBe('recovered');
    expect(update).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([100, 200]); // exponential backoff 100 -> 200
  });

  it('gives up after maxAttempts and reports exhaustion', async () => {
    const update = vi.fn().mockRejectedValue(transientErr({ status: 504 }));
    const onRetry = vi.fn();
    const onExhausted = vi.fn();
    await expect(
      retryUpdate('card', 'scope-x', update, {
        maxAttempts: 3,
        baseDelayMs: 50,
        factor: 2,
        sleepFn: async () => {},
        onRetry,
        onExhausted,
      }),
    ).rejects.toMatchObject({ status: 504 });
    expect(update).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2); // retries for attempts 1..maxAttempts-1
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on a 4xx error (non-transient)', async () => {
    const update = vi.fn().mockRejectedValue(transientErr({ status: 400 }));
    const onRetry = vi.fn();
    const onExhausted = vi.fn();
    await expect(
      retryUpdate('card', 'scope-x', update, {
        maxAttempts: 4,
        sleepFn: async () => {},
        onRetry,
        onExhausted,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });
});
