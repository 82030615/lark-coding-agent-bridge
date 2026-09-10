import { describe, expect, it } from 'vitest';
import { BRIDGE_SYSTEM_PROMPT } from '../../../src/agent/bridge-system-prompt';
import { codebuddyCapability } from '../../../src/agent/capability';
import { supportedModels } from '../../../src/agent/models';
import { agentKindFromString } from '../../../src/config/profile-store';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema';

describe('CodeBuddy capability contract', () => {
  it('defines CodeBuddy capability with session-based history and stdin prompt injection', () => {
    const profile = createDefaultProfileConfig({
      agentKind: 'codebuddy',
      accounts: {
        app: {
          id: 'cli_test',
          secret: '${APP_SECRET}',
          tenant: 'feishu',
        },
      },
      codebuddy: {
        binaryPath: '/usr/local/bin/codebuddy',
      },
      permissions: {
        defaultAccess: 'workspace',
        maxAccess: 'workspace',
      },
    });

    expect(codebuddyCapability(profile)).toMatchObject({
      agentId: 'codebuddy',
      sessionKind: 'codebuddy-session',
      promptInjection: 'stdin-prefix',
      supportsNativeHistory: true,
      systemPrompt: BRIDGE_SYSTEM_PROMPT,
      callback: {
        marker: '__bridge_cb',
        legacyMarkers: ['__claude_cb'],
      },
      permissions: {
        maxAccess: 'workspace',
      },
    });
  });

  it('exposes the hy4-preview (default) and other CodeBuddy models and accepts the codebuddy agent kind', () => {
    expect(agentKindFromString('codebuddy')).toBe('codebuddy');
    const models = supportedModels('codebuddy');
    expect(models).toEqual([
      { value: 'hy4-preview', label: 'Hy4 preview' },
      { value: 'hy3', label: 'HY3' },
      { value: 'hy3-x', label: 'Hy3-x-0.05' },
      { value: 'glm-5.3-flash', label: 'GLM-5.3-Flash-0.06' },
      { value: 'deepseek-v4-flash', label: 'Deepseek-V4-Flash-0.17' },
      { value: 'deepseek-v4.1-flash', label: 'Deepseek-V4.1-Flash-0.03' },
    ]);
    expect(models.some((m) => m.value === 'glm-5.3')).toBe(false);
    // Claude/Codex lists must be untouched.
    expect(supportedModels('claude').some((m) => m.value === 'claude-opus-4-8')).toBe(true);
    expect(supportedModels('codex').some((m) => m.value === 'gpt-5-codex')).toBe(true);
  });

  it('normalizes a codebuddy profile and requires a codebuddy binary config', () => {
    const profile = createDefaultProfileConfig({
      agentKind: 'codebuddy',
      accounts: {
        app: { id: 'cli_test', secret: '${APP_SECRET}', tenant: 'feishu' },
      },
      codebuddy: { binaryPath: '/usr/local/bin/codebuddy' },
    });
    expect(profile.agentKind).toBe('codebuddy');
    expect(profile.codebuddy?.binaryPath).toBe('/usr/local/bin/codebuddy');

    expect(() =>
      createDefaultProfileConfig({
        agentKind: 'codebuddy',
        accounts: { app: { id: 'cli_test', secret: '${APP_SECRET}', tenant: 'feishu' } },
      }),
    ).toThrow(/codebuddy profile requires codebuddy configuration/);
  });
});
