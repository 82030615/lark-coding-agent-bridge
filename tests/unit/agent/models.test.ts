import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  defaultModelFor,
  isDefaultModel,
  modelLabel,
  normalizeModelSelection,
  resolveModelArg,
  supportedModels,
} from '../../../src/agent/models.js';

describe('agent model catalog', () => {
  it('offers a distinct catalog per agent kind, each led by the default sentinel', () => {
    const claude = supportedModels('claude');
    const codex = supportedModels('codex');
    expect(claude[0]?.value).toBe(DEFAULT_MODEL);
    expect(codex[0]?.value).toBe(DEFAULT_MODEL);
    expect(claude.map((m) => m.value)).toContain('claude-opus-4-8');
    expect(codex.map((m) => m.value)).toContain('gpt-5-codex');
    expect(claude.map((m) => m.value)).not.toContain('gpt-5-codex');
  });

  it('treats unset and the default sentinel as "use agent default"', () => {
    expect(isDefaultModel(undefined)).toBe(true);
    expect(isDefaultModel('')).toBe(true);
    expect(isDefaultModel(DEFAULT_MODEL)).toBe(true);
    expect(isDefaultModel('claude-opus-4-8')).toBe(false);
  });

  it('coerces unknown / cross-agent selections back to the default option', () => {
    expect(normalizeModelSelection('claude', 'claude-opus-4-8')).toBe('claude-opus-4-8');
    // A Codex model left over after switching a profile to Claude is invalid.
    expect(normalizeModelSelection('claude', 'gpt-5-codex')).toBe(DEFAULT_MODEL);
    expect(normalizeModelSelection('claude', undefined)).toBe(DEFAULT_MODEL);
  });

  it('resolves the --model argument, omitting it for the default', () => {
    expect(resolveModelArg('claude', 'claude-sonnet-5')).toBe('claude-sonnet-5');
    expect(resolveModelArg('claude', DEFAULT_MODEL)).toBeUndefined();
    expect(resolveModelArg('claude', undefined)).toBeUndefined();
    // Cross-agent value → no flag rather than a broken model.
    expect(resolveModelArg('codex', 'claude-opus-4-8')).toBeUndefined();
  });

  it('labels a stored value using the picker option text', () => {
    expect(modelLabel('claude', 'claude-opus-4-8')).toBe('Opus 4.8（最新）');
    expect(modelLabel('claude', DEFAULT_MODEL)).toContain('跟随默认');
  });

  it('exposes hy4-preview as the default and the other CodeBuddy models as alternatives', () => {
    expect(defaultModelFor('codebuddy')).toBe('hy4-preview');
    expect(supportedModels('codebuddy')).toEqual([
      { value: 'hy4-preview', label: 'Hy4 preview' },
      { value: 'hy3', label: 'HY3' },
      { value: 'hy3-x', label: 'Hy3-x-0.05' },
      { value: 'glm-5.3-flash', label: 'GLM-5.3-Flash-0.06' },
      { value: 'deepseek-v4-flash', label: 'Deepseek-V4-Flash-0.17' },
    ]);
    // Unset / default sentinel / unknown model all resolve to the CodeBuddy default (hy4-preview).
    expect(normalizeModelSelection('codebuddy', undefined)).toBe('hy4-preview');
    expect(normalizeModelSelection('codebuddy', DEFAULT_MODEL)).toBe('hy4-preview');
    expect(normalizeModelSelection('codebuddy', 'glm-5.3')).toBe('hy4-preview');
    // hy4-preview is passed explicitly (never omitted) — it is the definitive default.
    expect(resolveModelArg('codebuddy', 'hy4-preview')).toBe('hy4-preview');
    expect(resolveModelArg('codebuddy', undefined)).toBe('hy4-preview');
    expect(modelLabel('codebuddy', 'hy4-preview')).toBe('Hy4 preview');
    // The alternative models are also selectable.
    expect(resolveModelArg('codebuddy', 'hy3')).toBe('hy3');
    expect(resolveModelArg('codebuddy', 'hy3-x')).toBe('hy3-x');
    expect(resolveModelArg('codebuddy', 'glm-5.3-flash')).toBe('glm-5.3-flash');
    expect(resolveModelArg('codebuddy', 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });
});
