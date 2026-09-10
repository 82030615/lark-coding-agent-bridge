import { mkdir, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedMessage } from '@larksuite/channel';
import { ActiveRuns } from '../../../src/bot/active-runs.js';
import {
  tryHandleCommand,
  type CommandContext,
  type Controls,
} from '../../../src/commands/index.js';
import {
  createDefaultProfileConfig,
  type ProfileConfig,
} from '../../../src/config/profile-schema.js';
import {
  createRootConfig,
  loadRootConfig,
  saveRootConfig,
} from '../../../src/config/profile-store.js';
import { SessionStore } from '../../../src/session/store.js';
import { WorkspaceStore } from '../../../src/workspace/store.js';
import { createFakeAgent } from '../../helpers/fake-agent.js';
import { createFakeChannel, type FakeChannel } from '../../helpers/fake-channel.js';
import { createTmpProfile, type TmpProfile } from '../../helpers/tmp-profile.js';

interface RunOverrides {
  senderId?: string;
  mentions?: NormalizedMessage['mentions'];
}

interface Harness {
  tmp: TmpProfile;
  channel: FakeChannel;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  controls: Controls;
  run(content: string, overrides?: RunOverrides): Promise<boolean>;
}

const cleanups: Array<() => Promise<void>> = [];

describe('/cd alias shortcuts', () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('sets a shortcut with /cdset and switches with /cd <alias>', async () => {
    const h = await createHarness();
    const target = join(h.tmp.root, 'aiops');
    await mkdir(target, { recursive: true });
    const targetReal = await realpath(target);

    await expect(h.run(`/cdset aiops ${target}`)).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('已设置目录别名');

    const saved = await loadRootConfig(h.controls.configPath);
    expect(saved?.cdAliases?.aiops).toBe(targetReal);

    await expect(h.run('/cd aiops')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('已切换 cwd');
    expect(lastMarkdown(h.channel)).toContain(targetReal);
    expect(lastMarkdown(h.channel)).toContain('别名');
    expect(h.workspaces.cwdFor('chat-1')).toBe(targetReal);
    expect(h.sessions.getRaw('chat-1')).toBeUndefined();
  });

  it('keeps literal-path /cd behavior and error text unchanged', async () => {
    const h = await createHarness();
    const target = join(h.tmp.root, 'plain');
    await mkdir(target, { recursive: true });

    await expect(h.run('/cd relative')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('请使用绝对路径');
    expect(lastMarkdown(h.channel)).toContain('未找到目录别名');

    await expect(h.run('/cd ~/definitely-missing-xyz')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('不存在或不可访问');

    await expect(h.run(`/cd ${target}`)).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('已切换 cwd');
    expect(lastMarkdown(h.channel)).not.toContain('别名');
  });

  it('never concatenates an alias with a sub-path', async () => {
    const h = await createHarness();
    const target = join(h.tmp.root, 'aiops');
    await mkdir(join(target, 'src'), { recursive: true });
    const before = h.workspaces.cwdFor('chat-1');

    await expect(h.run(`/cdset aiops ${target}`)).resolves.toBe(true);
    await expect(h.run('/cd aiops/src')).resolves.toBe(true);

    expect(lastMarkdown(h.channel)).toContain('请使用绝对路径');
    expect(lastMarkdown(h.channel)).not.toContain('已切换 cwd');
    expect(h.workspaces.cwdFor('chat-1')).toBe(before);
  });

  it('rejects shortcut targets that fail the working-directory gate', async () => {
    const h = await createHarness();

    await expect(h.run('/cdset home ~')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('Home 根目录');

    await expect(h.run(`/cdset tmp ${tmpdir()}`)).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('临时目录根');

    await expect(h.run('/cdset gone ~/definitely-missing-xyz')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('不存在或不可访问');

    const saved = await loadRootConfig(h.controls.configPath);
    expect(saved?.cdAliases).toBeUndefined();
    // `home` is a reserved-ish name? No: it failed the gate, never the name check.
    expect(homedir()).toBeTruthy();
  });

  it('reports a clear error when a shortcut target disappears', async () => {
    const h = await createHarness();
    const target = join(h.tmp.root, 'aiops');
    await mkdir(target, { recursive: true });

    await expect(h.run(`/cdset aiops ${target}`)).resolves.toBe(true);
    await rm(target, { recursive: true, force: true });

    await expect(h.run('/cd aiops')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('指向的目录不可用');
    expect(lastMarkdown(h.channel)).toContain('不存在或不可访问');

    // The alias is kept — it is not silently dropped.
    const saved = await loadRootConfig(h.controls.configPath);
    expect(saved?.cdAliases?.aiops).toBeTruthy();
  });

  it('lists and removes shortcuts', async () => {
    const h = await createHarness();
    const target = join(h.tmp.root, 'aiops');
    await mkdir(target, { recursive: true });
    const targetReal = await realpath(target);

    await expect(h.run('/cdset list')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('还没有目录别名');

    await expect(h.run(`/cdset aiops ${target}`)).resolves.toBe(true);

    await expect(h.run('/cdset')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('目录别名');
    expect(lastMarkdown(h.channel)).toContain('`aiops`');
    expect(lastMarkdown(h.channel)).toContain(targetReal);

    await expect(h.run('/cdset remove nope')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('未找到目录别名');

    await expect(h.run('/cdset remove aiops')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('已删除目录别名');

    const saved = await loadRootConfig(h.controls.configPath);
    expect(saved?.cdAliases).toBeUndefined();
  });

  it('rejects reserved and malformed shortcut names', async () => {
    const h = await createHarness();
    const target = join(h.tmp.root, 'aiops');
    await mkdir(target, { recursive: true });

    // `list` is a sub-command verb, never an alias name.
    await expect(h.run(`/cdset list ${target}`)).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).not.toContain('已设置目录别名');

    for (const bad of ['a/b', '-x', '.env']) {
      await expect(h.run(`/cdset ${bad} ${target}`)).resolves.toBe(true);
      expect(lastMarkdown(h.channel)).toContain('不合法');
    }

    await expect(h.run('/cdset rm')).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('`/cdset remove');

    const saved = await loadRootConfig(h.controls.configPath);
    expect(saved?.cdAliases).toBeUndefined();
  });

  it('keeps /cd and /cdset admin-only', async () => {
    const h = await createHarness();
    const target = join(h.tmp.root, 'aiops');
    await mkdir(target, { recursive: true });
    const notAdmin = { senderId: 'ou-not-admin' };

    await expect(h.run(`/cdset aiops ${target}`, notAdmin)).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('仅管理员可用');

    await expect(h.run('/cdset list', notAdmin)).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('仅管理员可用');

    await expect(h.run('/cd aiops', notAdmin)).resolves.toBe(true);
    expect(lastMarkdown(h.channel)).toContain('仅管理员可用');

    const saved = await loadRootConfig(h.controls.configPath);
    expect(saved?.cdAliases).toBeUndefined();
  });

  it('surfaces /cdset in the /help card', async () => {
    const h = await createHarness();

    await expect(h.run('/help')).resolves.toBe(true);
    const content = h.channel.sent.at(-1)?.content as Record<string, unknown> | undefined;
    expect(content).toBeTypeOf('object');
    expect(JSON.stringify(content)).toContain('/cdset');
  });

  it('preserves /cd shortcuts when another config op rewrites the root', async () => {
    const h = await createHarness();
    const target = join(h.tmp.root, 'aiops');
    await mkdir(target, { recursive: true });
    const targetReal = await realpath(target);

    await expect(h.run(`/cdset aiops ${target}`)).resolves.toBe(true);

    await expect(
      h.run('/invite user @Alice', { mentions: [mention('ou-alice', 'Alice')] }),
    ).resolves.toBe(true);

    const saved = await loadRootConfig(h.controls.configPath);
    expect(saved?.cdAliases?.aiops).toBe(targetReal);
    expect(saved?.profiles.claude?.access.allowedUsers).toContain('ou-alice');
  });
});

async function createHarness(): Promise<Harness> {
  const tmp = await createTmpProfile('cd-alias-');
  const channel = createFakeChannel();
  const sessions = new SessionStore(join(tmp.profile, 'sessions.json'));
  const workspaces = new WorkspaceStore(join(tmp.profile, 'workspaces.json'));
  const activeRuns = new ActiveRuns();
  const agent = createFakeAgent();
  const workspaceRealpath = await realpath(tmp.workspace);
  const profileConfig = appConfig(workspaceRealpath);
  const configPath = join(tmp.root, 'config.json');
  await saveRootConfig(createRootConfig('claude', profileConfig), configPath);
  const controls = {
    profile: 'claude',
    profileConfig,
    botOwnerId: 'ou-owner',
    ownerRefreshState: 'ok',
    ownerRefreshedAt: 1_700_000_000_000,
    async refreshOwner() {},
    restart: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
    configPath,
    cfg: profileConfig,
    processId: 'proc-1',
  } satisfies Controls;

  workspaces.setCwd('chat-1', workspaceRealpath);

  const run = (content: string, overrides: RunOverrides = {}): Promise<boolean> =>
    tryHandleCommand({
      channel: channel as unknown as CommandContext['channel'],
      msg: message(content, {
        chatId: 'chat-1',
        senderId: overrides.senderId ?? 'ou-admin',
        mentions: overrides.mentions ?? [],
      }),
      scope: 'chat-1',
      chatMode: 'p2p',
      sessions,
      workspaces,
      agent,
      activeRuns,
      controls,
    });

  cleanups.push(async () => {
    await Promise.all([sessions.flush(), workspaces.flush()]);
    await tmp.cleanup();
  });

  return { tmp, channel, sessions, workspaces, controls, run };
}

function appConfig(defaultWorkspace: string): ProfileConfig {
  const config = createDefaultProfileConfig({
    agentKind: 'claude',
    accounts: { app: { id: 'app-id', secret: 'secret', tenant: 'feishu' } },
    access: { admins: ['ou-admin'] },
    sandbox: { defaultMode: 'read-only', maxMode: 'workspace-write' },
    preferences: { maxConcurrentRuns: 2 },
  });
  config.workspaces.default = defaultWorkspace;
  return config;
}

function message(
  content: string,
  opts: { chatId: string; senderId: string; mentions?: NormalizedMessage['mentions'] },
): NormalizedMessage {
  return {
    messageId: `om-${content.replace(/\W+/g, '-').slice(0, 20)}`,
    chatId: opts.chatId,
    chatType: 'p2p',
    senderId: opts.senderId,
    senderName: 'User',
    content,
    resources: [],
    mentions: opts.mentions ?? [],
    mentionedBot: false,
  } as unknown as NormalizedMessage;
}

function mention(openId: string, name: string): NonNullable<NormalizedMessage['mentions']>[number] {
  return {
    openId,
    name,
    isBot: false,
  } as NonNullable<NormalizedMessage['mentions']>[number];
}

function lastMarkdown(channel: FakeChannel): string {
  const content = channel.sent.at(-1)?.content as Record<string, unknown> | undefined;
  expect(content).toBeTypeOf('object');
  expect(content?.markdown).toBeTypeOf('string');
  return content?.markdown as string;
}
