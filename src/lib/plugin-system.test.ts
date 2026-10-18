/**
 * Plugin System Tests
 *
 * Tests for the plugin lifecycle, dependency resolution, priority ordering,
 * hook emission, composition helpers, and factory utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PluginSystem,
  PluginHook,
  createPlugin,
  composePlugins,
  type Plugin,
  type PluginHookContext,
} from './plugin-system';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock DorisioClient-like object for tests. */
const makeMockClient = () => ({} as any);

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return createPlugin({
    name: 'test-plugin',
    version: '1.0.0',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// PluginSystem – basic install / uninstall
// ---------------------------------------------------------------------------

describe('PluginSystem – install / uninstall', () => {
  let system: PluginSystem;

  beforeEach(() => {
    system = new PluginSystem();
  });

  it('installs a plugin and makes it discoverable', async () => {
    const plugin = makePlugin({ name: 'a' });
    await system.install(plugin);

    expect(system.isPluginInstalled('a')).toBe(true);
    expect(system.getPlugin('a')).toBe(plugin);
    expect(system.getPlugins()).toContain(plugin);
  });

  it('throws when installing the same plugin twice', async () => {
    const plugin = makePlugin({ name: 'dup' });
    await system.install(plugin);
    await expect(system.install(plugin)).rejects.toThrow(/already installed/);
  });

  it('calls the plugin install hook with the client', async () => {
    const client = makeMockClient();
    await system.initialize(client);

    const installFn = vi.fn();
    const plugin = makePlugin({ name: 'with-install', install: installFn });
    await system.install(plugin);

    expect(installFn).toHaveBeenCalledWith(client, expect.any(Object));
  });

  it('uninstalls a plugin and removes it from the registry', async () => {
    const plugin = makePlugin({ name: 'b' });
    await system.install(plugin);
    await system.uninstall('b');

    expect(system.isPluginInstalled('b')).toBe(false);
    expect(system.getPlugin('b')).toBeUndefined();
  });

  it('throws when uninstalling a non-existent plugin', async () => {
    await expect(system.uninstall('ghost')).rejects.toThrow(/not installed/);
  });

  it('calls the plugin uninstall hook', async () => {
    const client = makeMockClient();
    await system.initialize(client);

    const uninstallFn = vi.fn();
    const plugin = makePlugin({ name: 'with-uninstall', uninstall: uninstallFn });
    await system.install(plugin);
    await system.uninstall('with-uninstall');

    expect(uninstallFn).toHaveBeenCalledWith(client);
  });
});

// ---------------------------------------------------------------------------
// PluginSystem – dependency resolution
// ---------------------------------------------------------------------------

describe('PluginSystem – dependency resolution', () => {
  let system: PluginSystem;

  beforeEach(() => {
    system = new PluginSystem();
  });

  it('installs a plugin when all dependencies are already present', async () => {
    await system.install(makePlugin({ name: 'base' }));
    const dependant = makePlugin({ name: 'dependant', dependencies: ['base'] });
    await expect(system.install(dependant)).resolves.toBeUndefined();
  });

  it('throws when a dependency is missing', async () => {
    const dependant = makePlugin({ name: 'orphan', dependencies: ['missing-dep'] });
    await expect(system.install(dependant)).rejects.toThrow(/missing dependencies.*missing-dep/);
  });

  it('lists all missing deps in the error message', async () => {
    const plugin = makePlugin({
      name: 'multi-dep',
      dependencies: ['dep-a', 'dep-b'],
    });
    await expect(system.install(plugin)).rejects.toThrow(/dep-a.*dep-b|dep-b.*dep-a/);
  });
});

// ---------------------------------------------------------------------------
// PluginSystem – priority ordering
// ---------------------------------------------------------------------------

describe('PluginSystem – priority ordering', () => {
  let system: PluginSystem;
  let callOrder: string[];

  beforeEach(() => {
    system = new PluginSystem();
    callOrder = [];
  });

  it('calls handlers in ascending priority order', async () => {
    await system.install(
      makePlugin({
        name: 'high-priority',
        priority: 10,
        hooks: {
          [PluginHook.BeforeRequest]: () => {
            callOrder.push('high');
          },
        },
      })
    );

    await system.install(
      makePlugin({
        name: 'low-priority',
        priority: 200,
        hooks: {
          [PluginHook.BeforeRequest]: () => {
            callOrder.push('low');
          },
        },
      })
    );

    await system.emit(PluginHook.BeforeRequest);
    expect(callOrder).toEqual(['high', 'low']);
  });

  it('defaults priority to 100 when not specified', () => {
    const plugin = createPlugin({ name: 'default' });
    expect(plugin.priority).toBe(100);
  });

  it('getPlugins() returns plugins sorted by priority ascending', async () => {
    await system.install(makePlugin({ name: 'z', priority: 50 }));
    await system.install(makePlugin({ name: 'a', priority: 5 }));
    await system.install(makePlugin({ name: 'm', priority: 25 }));

    const names = system.getPlugins().map((p) => p.name);
    expect(names).toEqual(['a', 'm', 'z']);
  });
});

// ---------------------------------------------------------------------------
// PluginSystem – hook emission
// ---------------------------------------------------------------------------

describe('PluginSystem – hook emission', () => {
  let system: PluginSystem;

  beforeEach(() => {
    system = new PluginSystem();
  });

  it('emits a hook and passes the context to handlers', async () => {
    const handler = vi.fn();
    await system.install(
      makePlugin({
        name: 'hook-listener',
        hooks: { [PluginHook.OnSuccess]: handler },
      })
    );

    await system.emit(PluginHook.OnSuccess, { method: 'createTip', result: { id: '1' } });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'createTip', result: { id: '1' } })
    );
  });

  it('includes timestamp in context', async () => {
    const handler = vi.fn();
    await system.install(
      makePlugin({ name: 'ts-listener', hooks: { [PluginHook.OnSuccess]: handler } })
    );
    await system.emit(PluginHook.OnSuccess);
    expect((handler.mock.calls[0][0] as PluginHookContext).timestamp).toBeGreaterThan(0);
  });

  it('continues to next handler when one errors', async () => {
    const second = vi.fn();
    await system.install(
      makePlugin({
        name: 'erroring-plugin',
        hooks: {
          [PluginHook.OnError]: () => {
            throw new Error('handler boom');
          },
        },
      })
    );
    await system.install(
      makePlugin({
        name: 'surviving-plugin',
        hooks: { [PluginHook.OnError]: second },
      })
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await system.emit(PluginHook.OnError);
    consoleSpy.mockRestore();

    expect(second).toHaveBeenCalled();
  });

  it('removes hook handlers when plugin is uninstalled', async () => {
    const handler = vi.fn();
    await system.install(
      makePlugin({ name: 'temp', hooks: { [PluginHook.BeforeRequest]: handler } })
    );
    await system.uninstall('temp');
    await system.emit(PluginHook.BeforeRequest);

    expect(handler).not.toHaveBeenCalled();
  });

  it('fires BeforeInit and AfterInit during initialize()', async () => {
    const beforeInit = vi.fn();
    const afterInit = vi.fn();
    await system.install(
      makePlugin({
        name: 'init-listener',
        hooks: {
          [PluginHook.BeforeInit]: beforeInit,
          [PluginHook.AfterInit]: afterInit,
        },
      })
    );
    await system.initialize(makeMockClient());

    expect(beforeInit).toHaveBeenCalled();
    expect(afterInit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PluginSystem – options / config merging
// ---------------------------------------------------------------------------

describe('PluginSystem – options merging', () => {
  let system: PluginSystem;

  beforeEach(() => {
    system = new PluginSystem();
  });

  it('merges plugin.config with per-install options', async () => {
    const plugin = makePlugin({
      name: 'configurable',
      config: { retries: 3, verbose: false },
    });
    await system.install(plugin, { verbose: true, extra: 'yes' });

    const opts = system.getPluginOptions('configurable');
    expect(opts).toEqual({ retries: 3, verbose: true, extra: 'yes' });
  });

  it('passes merged options to the install callback', async () => {
    const installFn = vi.fn();
    await system.initialize(makeMockClient());
    await system.install(
      makePlugin({ name: 'opts-cb', config: { a: 1 }, install: installFn }),
      { b: 2 }
    );

    expect(installFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ a: 1, b: 2 })
    );
  });

  it('returns undefined options for unknown plugin', () => {
    expect(system.getPluginOptions('unknown')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PluginSystem – composition
// ---------------------------------------------------------------------------

describe('PluginSystem – compose', () => {
  it('merges hooks from multiple plugins, first-one-wins', () => {
    const system = new PluginSystem();
    const aHandler = vi.fn();
    const bHandler = vi.fn();

    const a = makePlugin({
      name: 'a',
      hooks: { [PluginHook.BeforeRequest]: aHandler },
    });
    const b = makePlugin({
      name: 'b',
      hooks: { [PluginHook.BeforeRequest]: bHandler, [PluginHook.OnError]: bHandler },
    });

    const { plugin, isComposite, dependencies } = system.compose([a, b], 'a+b');

    expect(isComposite).toBe(true);
    expect(dependencies).toEqual(['a', 'b']);
    expect(plugin.hooks?.[PluginHook.BeforeRequest]).toBe(aHandler);
    expect(plugin.hooks?.[PluginHook.OnError]).toBe(bHandler);
  });

  it('sets composite priority to the minimum of all source priorities', () => {
    const system = new PluginSystem();
    const { plugin } = system.compose(
      [
        makePlugin({ name: 'p1', priority: 50 }),
        makePlugin({ name: 'p2', priority: 10 }),
        makePlugin({ name: 'p3', priority: 75 }),
      ],
      'composite'
    );
    expect(plugin.priority).toBe(10);
  });

  it('includes all source names in the description', () => {
    const system = new PluginSystem();
    const { plugin } = system.compose(
      [makePlugin({ name: 'x' }), makePlugin({ name: 'y' })],
      'xy'
    );
    expect(plugin.description).toContain('x');
    expect(plugin.description).toContain('y');
  });
});

// ---------------------------------------------------------------------------
// composePlugins factory helper
// ---------------------------------------------------------------------------

describe('composePlugins()', () => {
  it('returns a single plugin that merges the given plugins', () => {
    const aHandler = vi.fn();
    const a = makePlugin({ name: 'a', hooks: { [PluginHook.OnSuccess]: aHandler } });
    const b = makePlugin({ name: 'b' });

    const composed = composePlugins('merged', a, b);
    expect(composed.name).toBe('merged');
    expect(composed.hooks?.[PluginHook.OnSuccess]).toBe(aHandler);
  });
});

// ---------------------------------------------------------------------------
// PluginSystem – clear & shutdown
// ---------------------------------------------------------------------------

describe('PluginSystem – clear & shutdown', () => {
  it('clear() uninstalls all plugins', async () => {
    const system = new PluginSystem();
    await system.install(makePlugin({ name: 'c1' }));
    await system.install(makePlugin({ name: 'c2' }));

    await system.clear();

    expect(system.getPlugins()).toHaveLength(0);
  });

  it('clear() uninstalls in reverse installation order', async () => {
    const system = new PluginSystem();
    const order: string[] = [];
    await system.install(
      makePlugin({ name: 'first', uninstall: () => { order.push('first'); } })
    );
    await system.install(
      makePlugin({ name: 'second', uninstall: () => { order.push('second'); } })
    );

    await system.initialize(makeMockClient());
    await system.clear();

    expect(order).toEqual(['second', 'first']);
  });

  it('shutdown() fires BeforeShutdown and AfterShutdown', async () => {
    const system = new PluginSystem();
    const before = vi.fn();
    const after = vi.fn();

    await system.install(
      makePlugin({
        name: 'shutdown-listener',
        hooks: {
          [PluginHook.BeforeShutdown]: before,
          [PluginHook.AfterShutdown]: after,
        },
      })
    );
    await system.initialize(makeMockClient());
    await system.shutdown();

    expect(before).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PluginSystem – statistics
// ---------------------------------------------------------------------------

describe('PluginSystem – getStats()', () => {
  it('returns totalPlugins count', async () => {
    const system = new PluginSystem();
    await system.install(makePlugin({ name: 's1' }));
    await system.install(makePlugin({ name: 's2' }));

    const { totalPlugins } = system.getStats();
    expect(totalPlugins).toBe(2);
  });

  it('returns per-hook handler counts', async () => {
    const system = new PluginSystem();
    await system.install(
      makePlugin({ name: 'h1', hooks: { [PluginHook.OnSuccess]: vi.fn() } })
    );
    await system.install(
      makePlugin({ name: 'h2', hooks: { [PluginHook.OnSuccess]: vi.fn() } })
    );

    const { hookCount } = system.getStats();
    expect(hookCount.get(PluginHook.OnSuccess)).toBe(2);
  });

  it('returns per-plugin stat entries with metadata', async () => {
    const system = new PluginSystem();
    await system.install(
      makePlugin({ name: 'detailed', version: '2.0.0', description: 'Test', priority: 42 })
    );

    const { plugins } = system.getStats();
    const entry = plugins.find((p) => p.name === 'detailed');
    expect(entry).toMatchObject({
      name: 'detailed',
      version: '2.0.0',
      description: 'Test',
      priority: 42,
    });
    expect(entry?.installedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// createPlugin factory
// ---------------------------------------------------------------------------

describe('createPlugin()', () => {
  it('applies default priority of 100', () => {
    const plugin = createPlugin({ name: 'no-priority' });
    expect(plugin.priority).toBe(100);
  });

  it('respects an explicitly provided priority', () => {
    const plugin = createPlugin({ name: 'custom-priority', priority: 5 });
    expect(plugin.priority).toBe(5);
  });

  it('returns all provided fields', () => {
    const install = vi.fn();
    const plugin = createPlugin({ name: 'full', version: '3.0.0', install });
    expect(plugin.name).toBe('full');
    expect(plugin.version).toBe('3.0.0');
    expect(plugin.install).toBe(install);
  });
});
