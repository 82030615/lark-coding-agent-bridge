import { describe, expect, it } from 'vitest';
import type { RunState } from '../../../src/card/run-state';
import { hasDeliverableContent, terminalStatusLine } from '../../../src/card/status-text';

function base(over: Partial<RunState> = {}): RunState {
  return {
    blocks: [],
    reasoning: { content: '', active: false },
    footer: null,
    terminal: 'done',
    ...over,
  };
}

describe('terminalStatusLine', () => {
  it('error shows ⚠️ agent 失败', () => {
    expect(terminalStatusLine(base({ terminal: 'error', errorMsg: 'boom' }))).toBe(
      '⚠️ agent 失败：boom',
    );
  });

  it('error without msg renders no undefined literal', () => {
    expect(terminalStatusLine(base({ terminal: 'error' }))).toBe('⚠️ agent 失败：');
  });

  it('interrupted shows ⏹ 已中断', () => {
    expect(terminalStatusLine(base({ terminal: 'interrupted' }))).toBe('_⏹ 已中断_');
  });

  it('idle_timeout shows 已超时 and 已自动终止', () => {
    expect(
      terminalStatusLine(base({ terminal: 'idle_timeout', idleTimeoutMinutes: 15 })),
    ).toBe('_⏱ 已超时（15 分钟无响应），已自动终止_');
  });

  it('done with text shows ✅ 已完成', () => {
    expect(
      terminalStatusLine(base({ blocks: [{ kind: 'text', content: 'hi', streaming: false }] })),
    ).toBe('_✅ 已完成_');
  });

  it('done with tool shows ✅ 已完成', () => {
    expect(
      terminalStatusLine(
        base({ blocks: [{ kind: 'tool', tool: { id: 't', name: 'Bash', input: {}, status: 'done' } }] }),
      ),
    ).toBe('_✅ 已完成_');
  });

  it('done empty returns empty string (renderer decides)', () => {
    expect(terminalStatusLine(base({ blocks: [], finalText: undefined }))).toBe('');
  });

  it('running returns empty string', () => {
    expect(terminalStatusLine(base({ terminal: 'running' }))).toBe('');
  });
});

describe('hasDeliverableContent', () => {
  it('false when only reasoning', () => {
    expect(hasDeliverableContent(base({ reasoning: { content: 'thinking...', active: false } }))).toBe(
      false,
    );
  });

  it('true when text block present', () => {
    expect(
      hasDeliverableContent(base({ blocks: [{ kind: 'text', content: 'x', streaming: false }] })),
    ).toBe(true);
  });

  it('true when tool block present', () => {
    expect(
      hasDeliverableContent(
        base({ blocks: [{ kind: 'tool', tool: { id: 't', name: 'Bash', input: {}, status: 'done' } }] }),
      ),
    ).toBe(true);
  });

  it('true when finalText present', () => {
    expect(hasDeliverableContent(base({ finalText: '  answer  ' }))).toBe(true);
  });

  it('false when only whitespace text', () => {
    expect(
      hasDeliverableContent(base({ blocks: [{ kind: 'text', content: '   ', streaming: false }] })),
    ).toBe(false);
  });
});
