import { describe, expect, it } from 'vitest';
import {
  initialState,
  reduce,
  finalizeIfRunning,
  markInterrupted,
  markIdleTimeout,
  type RunState,
} from '../../../src/card/run-state';
import { renderCard } from '../../../src/card/run-renderer';

/**
 * Regression: a run that ends (any terminal state) while a tool_use never
 * received its matching tool_result must NOT leave the tool block stuck at
 * status 'running' — otherwise the Feishu card keeps showing
 * "正在调用工具 / 运行中…" after the whole turn is over.
 *
 * The dangling tool's outcome is unknown (result dropped in transit, or the
 * run was cut off mid-call), so it is marked 'lost' rather than falsely
 * 'done' (implies success) or 'error' (implies the tool itself failed).
 */
function streamWithoutToolResult(): RunState {
  let state = initialState;
  state = reduce(state, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hi' } });
  state = reduce(state, { type: 'text', delta: 'done' });
  return state;
}

describe('tool_use without tool_result settles to lost at terminal', () => {
  const terminalStates: Array<[string, RunState]> = [
    ['done', reduce(streamWithoutToolResult(), { type: 'done', terminationReason: 'normal' })],
    ['error', reduce(streamWithoutToolResult(), { type: 'error', message: 'boom', terminationReason: 'failed' })],
    ['finalizeIfRunning', finalizeIfRunning(streamWithoutToolResult())],
    ['markInterrupted', markInterrupted(streamWithoutToolResult())],
    ['markIdleTimeout', markIdleTimeout(streamWithoutToolResult(), 5)],
  ];

  for (const [name, finalState] of terminalStates) {
    it(`settles the dangling tool to 'lost' on terminal='${name}'`, () => {
      const toolBlocks = finalState.blocks.filter(
        (b): b is Extract<typeof b, { kind: 'tool' }> => b.kind === 'tool',
      );
      expect(toolBlocks).toHaveLength(1);
      expect(toolBlocks[0]!.tool.status).toBe('lost');
    });

    it(`renders a settled (not spinning) tool panel on terminal='${name}'`, () => {
      const card = JSON.stringify(renderCard(finalState));
      expect(card).toContain('结果未返回');
      expect(card).toContain('⚠️');
      expect(card).not.toContain('运行中');
      expect(card).not.toContain('⏳');
    });
  }

  it('does not touch tools that did receive a tool_result', () => {
    let state = initialState;
    state = reduce(state, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } });
    state = reduce(state, { type: 'tool_result', id: 't1', output: '/repo', isError: false });
    state = reduce(state, { type: 'done', terminationReason: 'normal' });
    const toolBlocks = state.blocks.filter(
      (b): b is Extract<typeof b, { kind: 'tool' }> => b.kind === 'tool',
    );
    expect(toolBlocks[0]!.tool.status).toBe('done');
  });
});
