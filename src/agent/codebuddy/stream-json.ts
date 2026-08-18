import type { AgentEvent } from '../types';
import { translateEvent as claudeTranslateEvent } from '../claude/stream-json';

/**
 * CodeBuddy emits a Claude-Code-compatible `stream-json` protocol, so the line
 * shapes (init / assistant / user / result) are the same as Claude's and we
 * reuse Claude's translator as the baseline. Two CodeBuddy-specific quirks need
 * handling on top of that baseline:
 *
 *  1. The whole final answer is sometimes delivered ONLY inside `result.result`
 *     (the final assistant message then contains just a `thinking` block, no
 *     `text` block — observed in real `-p --output-format stream-json` runs).
 *     Claude's translator surfaces text via assistant `text` blocks and ignores
 *     `result.result`, so without this fix the user would see the thinking but
 *     NOT the final answer. We emit a `final_text` event from `result.result`
 *     when the final assistant message had no `text` block (to avoid showing it
 *     twice when CodeBuddy also echoes it as an assistant `text` block).
 *
 *  2. `tool_result.content` is an array of `{ type: 'text', text }` blocks
 *     (not a plain string like Claude). Claude's translator would
 *     `JSON.stringify` that array, which renders badly in the Feishu card, so
 *     we flatten it to clean text here.
 *
 * The translator is stateful per stream (the `final_text` dedup needs to know
 * whether an assistant `text` block appeared since the last `result`). Create
 * one instance per stream via `createCodeBuddyTranslator()` — do NOT share a
 * single instance across concurrent runs.
 */
export interface CodeBuddyTranslator {
  (raw: unknown): Generator<AgentEvent>;
}

export function createCodeBuddyTranslator(): CodeBuddyTranslator {
  let sawAssistantTextSinceLastResult = false;

  return function* translateEvent(raw: unknown): Generator<AgentEvent> {
    const evt = (raw ?? null) as { type?: string; [key: string]: unknown } | null;
    if (!evt || typeof evt !== 'object') return;

    if (evt.type === 'assistant') {
      const content = (evt as { message?: { content?: unknown } }).message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'text' &&
            typeof (block as { text?: unknown }).text === 'string' &&
            (block as { text?: string }).text
          ) {
            sawAssistantTextSinceLastResult = true;
          }
        }
      }
      yield* claudeTranslateEvent(raw);
      return;
    }

    if (evt.type === 'user') {
      const content = (evt as { message?: { content?: unknown } }).message?.content;
      if (Array.isArray(content)) {
        let emitted = false;
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'tool_result' &&
            typeof (block as { tool_use_id?: unknown }).tool_use_id === 'string'
          ) {
            const b = block as {
              tool_use_id: string;
              content?: unknown;
              is_error?: boolean;
            };
            yield {
              type: 'tool_result',
              id: b.tool_use_id,
              output: renderToolResultContent(b.content),
              isError: b.is_error === true,
            };
            emitted = true;
          }
        }
        if (emitted) return;
      }
      yield* claudeTranslateEvent(raw);
      return;
    }

    if (evt.type === 'result') {
      const resultText =
        typeof (evt as { result?: unknown }).result === 'string'
          ? ((evt as { result: string }).result as string)
          : '';
      const sawText = sawAssistantTextSinceLastResult;
      sawAssistantTextSinceLastResult = false;
      // Emit the conclusive answer before usage/done so the card finalizes
      // text in the natural order.
      if (resultText && !sawText) {
        yield { type: 'final_text', content: resultText };
      }
      yield* claudeTranslateEvent(raw);
      return;
    }

    yield* claudeTranslateEvent(raw);
  };
}

function renderToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (
          block &&
          typeof block === 'object' &&
          typeof (block as { text?: unknown }).text === 'string'
        ) {
          return (block as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return JSON.stringify(content);
}
