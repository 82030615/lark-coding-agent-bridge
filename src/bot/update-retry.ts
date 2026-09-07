/**
 * 终端卡片/文本更新的重试与退避。
 *
 * 背景：飞书流式卡片在终态（已完成/已中断/已超时/失败）最后一次 update 时，
 * 偶发 504/500/网络抖动导致更新静默失败，最终结论（emoji 终态标识、最终
 * 文本）未能送达，用户看到的是一张停在“正在调用工具”的卡。这里对“终态更新”
 * 增加指数退避重试，失败仍不可达时打 warn 便于排查（对应方案 1+3）。
 *
 * 注意：仅用于「终态更新」，中间 streaming 更新保持原样，避免引入额外延迟与行为变化。
 */

export interface RetryUpdateOptions {
  /** 最大尝试次数（含首次），默认 4。 */
  maxAttempts?: number;
  /** 首次退避基线毫秒，默认 500。 */
  baseDelayMs?: number;
  /** 退避放大系数，默认 2（指数退避：base, base*factor, base*factor^2 …）。 */
  factor?: number;
  /** 每次可重试失败（且尚未放弃）时回调，用于打 warn。 */
  onRetry?: (info: { attempt: number; err: unknown }) => void;
  /** 所有尝试失败放弃时回调，用于打明确 warn（结论可能丢失）。 */
  onExhausted?: (err: unknown) => void;
  /** 可注入的 sleep（测试用）。生产默认走真实 setTimeout。 */
  sleepFn?: (ms: number) => Promise<void>;
}

/** 提取可用于日志的错误摘要，附带可识别的 HTTP/协议状态码。 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as any;
    const status = anyErr.status ?? anyErr.statusCode ?? anyErr.code;
    return status !== undefined ? `${err.message} (status=${status})` : err.message;
  }
  return String(err);
}

/**
 * 判断错误是否「可重试」：网络层错误（断开/超时/fetch failed）、
 * HTTP 5xx、以及 408 请求超时。4xx（含 400/404/429）视为不可重试。
 */
export function isTransientError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.statusCode;
  if (typeof status === 'number') {
    if (status >= 500) return true;
    if (status === 408) return true;
    return false; // 4xx 不可重试
  }
  // 网络层错误通常没有 HTTP 状态码，按消息/名称识别。
  const message: string = anyErr?.message ?? String(err);
  const name: string = anyErr?.name ?? '';
  const netPattern =
    /fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network|timeout|timed out|aborted/i;
  if (netPattern.test(message) || netPattern.test(name)) return true;
  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 对一次更新操作做指数退避重试。仅当错误为「可重试」时重试；达到 maxAttempts
 * 仍失败则抛出最后一次错误。
 */
export async function retryUpdate<T>(
  label: string,
  scope: string,
  update: () => Promise<T>,
  opts: RetryUpdateOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const factor = opts.factor ?? 2;
  const sleep = opts.sleepFn ?? defaultSleep;

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await update();
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err)) {
        // 不可重试错误（如 4xx）：立即放弃，不计入退避。
        throw err;
      }
      if (attempt >= maxAttempts) {
        // 已达最大尝试次数，全部为可重试错误：放弃并提示结论可能丢失。
        opts.onExhausted?.(err);
        throw err;
      }
      const delay = Math.round(baseDelayMs * factor ** (attempt - 1));
      opts.onRetry?.({ attempt, err });
      await sleep(delay);
    }
  }
  throw lastErr;
}
