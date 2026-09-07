import type { RunState } from './run-state';

/**
 * True when the run produced something worth showing as a finished reply:
 * a final answer, any non-empty text block, or any tool call. Used to decide
 * whether a terminal card/text gets a "✅ 已完成" marker vs. an empty-done note.
 *
 * Reasoning alone does NOT count — a run that only thought but emitted no text
 * or tool output has nothing deliverable. This mirrors the old
 * `elements.length === 0` check (which counted reasoning panels) without
 * depending on render-time element bookkeeping.
 */
export function hasDeliverableContent(state: RunState): boolean {
  if (state.finalText?.trim()) return true;
  return state.blocks.some(
    (b) => (b.kind === 'text' && b.content.trim()) || b.kind === 'tool',
  );
}

/**
 * One-line terminal status for a finished run, shown at the end of the card /
 * text reply. Mirrors the running footer (🧠 正在思考 / 🧰 正在调用工具 /
 * ✍️ 正在输出) but signals "the turn ended".
 *
 * Returns `''` for non-terminal states and for an empty `done` — the caller
 * decides what (if anything) to render for an empty done. Text-mode replies
 * leave it empty so `sendFinalReply`'s "skip empty body" check still skips
 * ghost messages; card-mode falls back to "（未返回内容）".
 */
export function terminalStatusLine(state: RunState): string {
  switch (state.terminal) {
    case 'error':
      return `⚠️ agent 失败：${state.errorMsg ?? ''}`;
    case 'interrupted':
      return '_⏹ 已中断_';
    case 'idle_timeout':
      return `_⏱ 已超时（${state.idleTimeoutMinutes ?? 0} 分钟无响应），已自动终止_`;
    case 'done':
      return hasDeliverableContent(state) ? '_✅ 已完成_' : '';
    default:
      return '';
  }
}
