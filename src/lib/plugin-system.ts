/**
 * Plugin System
 *
 * Extensible plugin architecture for the Dorisio SDK.
 * Provides lifecycle hooks, dependency resolution, priority ordering,
 * a plugin factory helper, and a first-class API for extending the
 * DorisioClient with custom methods at install time.
 *
 * @example
 * ```ts
 * import { createPlugin, DorisioClient } from '@dorisio/sdk';
 *
 * const loggingPlugin = createPlugin({
 *   name: 'logging',
 *   version: '1.0.0',
 *   hooks: {
 *     beforeRequest: (ctx) => { console.log('[req]', ctx.method, ctx.args); },
 *     onError: (ctx) => { console.error('[err]', ctx.error?.message); },
 *   },
 * });
 *
 * const client = new DorisioClient({ baseUrl: '...' });
 * await client.installPlugin(loggingPlugin);
 * ```
 */

import type { DorisioClient } from '../client';

// ---------------------------------------------------------------------------
// Hook names
// ---------------------------------------------------------------------------

/**
 * All lifecycle points at which plugins may register handlers.
 */
export enum PluginHook {
  BeforeInit = 'beforeInit',
  AfterInit = 'afterInit',
  BeforeRequest = 'beforeRequest',
  AfterRequest = 'afterResponse',
  OnError = 'onError',
  OnSuccess = 'onSuccess',
  BeforeShutdown = 'beforeShutdown',
  AfterShutdown = 'afterShutdown',
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

/**
 * Context object passed to every plugin hook handler.
 * Plugins may read any field and attach arbitrary extra keys.
 */
export interface PluginHookContext {
  client?: DorisioClient;
  method?: string;
  args?: unknown[];
  result?: unknown;
  error?: Error;
  timestamp: number;
  [key: string]: unknown;
}

/** A single plugin hook handler function. */
export type PluginHookHandler = (context: PluginHookContext) => Promise<void> | void;

// ---------------------------------------------------------------------------
// Plugin descriptor
// ---------------------------------------------------------------------------

/**
 * Describes a plugin that can be installed into the SDK.
 */
export interface Plugin {
  /** Unique plugin identifier. Used as the key in the registry. */
  name: string;
  /** Semver-style version string (e.g. `"1.2.3"`). */
  version?: string;
  /** Human-readable description shown in `getStats()`. */
  description?: string;
  /**
   * Names of other plugins that **must** be installed before this one.
   * `PluginSystem.install()` throws if any dependency is missing.
   */
  dependencies?: string[];
  /**
   * Execution priority. Lower numbers run first (default: `100`).
   * Affects the order in which hook handlers are called when multiple
   * plugins register the same hook.
   */
  priority?: number;
  /**
   * Called once when the plugin is installed.
   * Use this to register hooks, extend the client, or set up resources.
   */
  install?: (client: DorisioClient, options?: Record<string, unknown>) => Promise<void> | void;
  /**
   * Called once when the plugin is uninstalled.
   * Use this to clean up any resources or extensions registered during install.
   */
  uninstall?: (client: DorisioClient) => Promise<void> | void;
  /**
   * Map of lifecycle hook names to handler functions.
   */
  hooks?: Partial<Record<PluginHook, PluginHookHandler>>;
  /**
   * Default configuration for this plugin.
   * Merged with per-install options when `install()` is called.
   */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

/** Installed plugin metadata stored in the registry. */
export interface InstalledPlugin {
  plugin: Plugin;
  installedAt: Date;
  /** Effective options used at install time (defaults merged with overrides). */
  options: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Result returned by `PluginSystem.compose()`. */
export interface PluginCompositionResult {
  plugin: Plugin;
  isComposite: boolean;
  dependencies: string[];
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Per-plugin metadata returned by `getStats()`. */
export interface PluginStatEntry {
  name: string;
  version?: string;
  description?: string;
  priority: number;
  installedAt: Date;
  hookCount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** @internal Resolve the numeric priority for a plugin. */
function pluginPriority(p: Plugin): number {
  return p.priority ?? 100;
}

// ---------------------------------------------------------------------------
// PluginSystem
// ---------------------------------------------------------------------------

/**
 * Manages the full lifecycle of SDK plugins:
 * registration, dependency checks, prioritised dispatch, composition, and
 * safe teardown.
 */
export class PluginSystem {
  private plugins = new Map<string, InstalledPlugin>();
  /** hook → sorted list of { handler, pluginName } */
  private hooks = new Map<PluginHook, Array<{ handler: PluginHookHandler; pluginName: string }>>();
  private client?: DorisioClient;

  constructor() {
    // Pre-populate every hook key so callers never have to null-check.
    for (const hook of Object.values(PluginHook)) {
      this.hooks.set(hook, []);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Bind the plugin system to a client instance.
   * Fires `beforeInit` → `afterInit` for any plugins that were pre-registered.
   */
  async initialize(client: DorisioClient): Promise<void> {
    this.client = client;
    await this.emit(PluginHook.BeforeInit, { client });
    await this.emit(PluginHook.AfterInit, { client });
  }

  // -------------------------------------------------------------------------
  // Install / Uninstall
  // -------------------------------------------------------------------------

  /**
   * Install a plugin into the system.
   *
   * @param plugin  - Plugin descriptor.
   * @param options - Per-install configuration overrides merged on top of `plugin.config`.
   * @throws If the plugin is already installed.
   * @throws If a declared dependency is not yet installed.
   */
  async install(plugin: Plugin, options: Record<string, unknown> = {}): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already installed`);
    }

    // Dependency check
    if (plugin.dependencies && plugin.dependencies.length > 0) {
      const missing = plugin.dependencies.filter((dep) => !this.plugins.has(dep));
      if (missing.length > 0) {
        throw new Error(
          `Plugin "${plugin.name}" requires missing dependencies: ${missing.join(', ')}`
        );
      }
    }

    // Merge config + options
    const effectiveOptions: Record<string, unknown> = {
      ...(plugin.config ?? {}),
      ...options,
    };

    // Run install callback
    if (plugin.install && this.client) {
      await plugin.install(this.client, effectiveOptions);
    }

    // Register hooks in priority order
    if (plugin.hooks) {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        const hook = hookName as PluginHook;
        const list = this.hooks.get(hook);
        if (list !== undefined && handler) {
          list.push({ handler, pluginName: plugin.name });
          // Re-sort by priority ascending (lower number = runs first)
          list.sort((a, b) => {
            const pa = this.plugins.get(a.pluginName)?.plugin.priority ?? 100;
            const pb = this.plugins.get(b.pluginName)?.plugin.priority ?? 100;
            return pa - pb;
          });
        }
      }
    }

    this.plugins.set(plugin.name, {
      plugin,
      installedAt: new Date(),
      options: effectiveOptions,
    });
  }

  /**
   * Uninstall a plugin and remove all of its hook handlers.
   *
   * @param pluginName - The `name` used when the plugin was installed.
   * @throws If the plugin is not installed.
   */
  async uninstall(pluginName: string): Promise<void> {
    const installed = this.plugins.get(pluginName);
    if (!installed) {
      throw new Error(`Plugin "${pluginName}" is not installed`);
    }

    const { plugin } = installed;

    if (plugin.uninstall && this.client) {
      await plugin.uninstall(this.client);
    }

    // Remove every hook handler that belongs to this plugin
    for (const list of this.hooks.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].pluginName === pluginName) {
          list.splice(i, 1);
        }
      }
    }

    this.plugins.delete(pluginName);
  }

  // -------------------------------------------------------------------------
  // Registry queries
  // -------------------------------------------------------------------------

  /** Return the plugin descriptor for the given name, or `undefined`. */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  /** Return all installed plugin descriptors, sorted by priority ascending. */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
      .sort((a, b) => pluginPriority(a.plugin) - pluginPriority(b.plugin))
      .map((i) => i.plugin);
  }

  /** Return `true` if a plugin with the given name is installed. */
  isPluginInstalled(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Return the effective options that were resolved at install time for the
   * given plugin (the merge of `plugin.config` and the per-call overrides).
   */
  getPluginOptions(name: string): Record<string, unknown> | undefined {
    return this.plugins.get(name)?.options;
  }

  // -------------------------------------------------------------------------
  // Hook emission
  // -------------------------------------------------------------------------

  /**
   * Fire a hook, calling every registered handler in priority order.
   * Handler errors are caught and logged but do not interrupt the chain.
   */
  async emit(hook: PluginHook, context?: Partial<PluginHookContext>): Promise<void> {
    const list = this.hooks.get(hook) ?? [];
    const fullContext: PluginHookContext = {
      timestamp: Date.now(),
      client: this.client,
      ...context,
    };

    for (const { handler, pluginName } of list) {
      try {
        await handler(fullContext);
      } catch (error) {
        console.error(
          `[PluginSystem] Error in hook "${hook}" from plugin "${pluginName}":`,
          error
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Composition
  // -------------------------------------------------------------------------

  /**
   * Merge multiple plugins into a single composite plugin.
   *
   * When the same hook is registered by more than one source plugin, the
   * **first** occurrence (by the order of the `plugins` array) wins.
   * All source plugin names are listed as dependencies of the composite.
   *
   * @param plugins - Plugins to merge.
   * @param name    - Name for the resulting composite plugin.
   */
  compose(plugins: Plugin[], name: string): PluginCompositionResult {
    const composedHooks: Partial<Record<PluginHook, PluginHookHandler>> = {};

    for (const plugin of plugins) {
      if (plugin.hooks) {
        for (const [hookName, handler] of Object.entries(plugin.hooks)) {
          const hook = hookName as PluginHook;
          if (!composedHooks[hook] && handler) {
            composedHooks[hook] = handler;
          }
        }
      }
    }

    const composedPlugin: Plugin = {
      name,
      description: `Composite plugin containing: ${plugins.map((p) => p.name).join(', ')}`,
      hooks: composedHooks,
      priority: plugins.length > 0 ? Math.min(...plugins.map((p) => p.priority ?? 100)) : 100,
    };

    return {
      plugin: composedPlugin,
      isComposite: true,
      dependencies: plugins.map((p) => p.name),
    };
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /**
   * Return an aggregated summary of the plugin registry.
   */
  getStats(): {
    totalPlugins: number;
    hookCount: Map<PluginHook, number>;
    plugins: PluginStatEntry[];
  } {
    const hookCount = new Map<PluginHook, number>();
    for (const [hook, list] of this.hooks.entries()) {
      hookCount.set(hook, list.length);
    }

    const plugins: PluginStatEntry[] = Array.from(this.plugins.values()).map(
      ({ plugin, installedAt }) => ({
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        priority: plugin.priority ?? 100,
        installedAt,
        hookCount: Object.keys(plugin.hooks ?? {}).length,
      })
    );

    return { totalPlugins: this.plugins.size, hookCount, plugins };
  }

  // -------------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------------

  /**
   * Uninstall all plugins in reverse installation order.
   */
  async clear(): Promise<void> {
    const names = Array.from(this.plugins.keys()).reverse();
    for (const name of names) {
      await this.uninstall(name);
    }
  }

  /**
   * Gracefully shut down the plugin system.
   * Fires `beforeShutdown`, uninstalls all plugins, then fires `afterShutdown`.
   */
  async shutdown(): Promise<void> {
    await this.emit(PluginHook.BeforeShutdown);
    const afterShutdownHandlers = [...(this.hooks.get(PluginHook.AfterShutdown) ?? [])];
    await this.clear();
    const fullContext: PluginHookContext = {
      timestamp: Date.now(),
      client: this.client,
    };
    for (const { handler, pluginName } of afterShutdownHandlers) {
      try {
        await handler(fullContext);
      } catch (error) {
        console.error(
          `[PluginSystem] Error in hook "${PluginHook.AfterShutdown}" from plugin "${pluginName}":`,
          error
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Convenience factory for creating type-safe plugin definitions without
 * needing to import the `Plugin` interface explicitly.
 *
 * @example
 * ```ts
 * const myPlugin = createPlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   hooks: {
 *     beforeRequest: (ctx) => { console.log('request', ctx.method); },
 *   },
 * });
 * ```
 */
export function createPlugin(definition: Plugin): Plugin {
  return {
    priority: 100,
    ...definition,
  };
}

/**
 * Build a plugin that composes (delegates to) several other plugins.
 * Equivalent to `new PluginSystem().compose(plugins, name).plugin`.
 *
 * @param name    - Name for the resulting composite plugin.
 * @param plugins - Source plugins to merge.
 */
export function composePlugins(name: string, ...plugins: Plugin[]): Plugin {
  const system = new PluginSystem();
  return system.compose(plugins, name).plugin;
}
