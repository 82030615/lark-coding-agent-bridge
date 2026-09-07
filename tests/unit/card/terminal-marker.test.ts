import { describe, expect, it } from 'vitest';
import { renderCard } from '../../../src/card/run-renderer';
import { renderText } from '../../../src/card/text-renderer';
import type { RunState } from '../../../src/card/run-state';

function state(over: Partial<RunState>): RunState {
  return {
    blocks: [],
    reasoning: { content: '', active: false },
    footer: null,
    terminal: 'done',
    ...over,
  };
}

/** The card JSON always embeds the marker text; assert via stringify. */
function card(s: RunState): string {
  return JSON.stringify(renderCard(s));
}

describe('terminal marker on card (run-renderer)', () => {
  it('done with content shows ✅ 已完成', () => {
    expect(card(state({ blocks: [{ kind: 'text', content: 'answer', streaming: false }] }))).toContain(
      '✅ 已完成',
    );
  });

  it('done empty shows （未返回内容）', () => {
    expect(card(state({ terminal: 'done' }))).toContain('未返回内容');
  });

  it('interrupted shows ⏹ 已中断', () => {
    expect(card(state({ terminal: 'interrupted' }))).toContain('⏹ 已中断');
  });

  it('idle_timeout shows 已超时 and 已自动终止', () => {
    const c = card(state({ terminal: 'idle_timeout', idleTimeoutMinutes: 15 }));
    expect(c).toContain('已超时');
    expect(c).toContain('已自动终止');
  });

  it('error shows ⚠️ agent 失败', () => {
    expect(card(state({ terminal: 'error', errorMsg: 'boom' }))).toContain('⚠️ agent 失败');
  });
});

describe('terminal marker in text mode (text-renderer)', () => {
  it('done with content shows ✅ 已完成', () => {
    const s = state({ blocks: [{ kind: 'text', content: 'answer', streaming: false }] });
    expect(renderText(s)).toContain('✅ 已完成');
  });

  // Regression guard: a final-only reply (Codex/cot) with no content must stay
  // empty so sendFinalReply still skips it — never a ghost "✅ 已完成（未返回内容）" message.
  it('done empty returns empty string (no ghost message)', () => {
    expect(renderText(state({ terminal: 'done' })).trim()).toBe('');
  });
});
