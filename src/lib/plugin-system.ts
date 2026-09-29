/**
 * Plugin System
 *
 * Extensible plugin architecture for SDK.
 * Allows plugins to hook into lifecycle events and extend functionality.
 */

import type { DorisioClient } from '../client';

/**
 * Plugin lifecycle hooks
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

/**
 * Plugin hook context passed to handlers
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

/**
 * Plugin hook handler type
 */
export type PluginHookHandler = (context: PluginHookContext) => Promise<void> | void;

/**
 * Plugin interface
 */
export interface Plugin {
  name: string;
  version?: string;
  description?: string;
  /**
   * Called when plugin is installed
   */
  install?: (client: DorisioClient) => Promise<void> | void;
  /**
   * Called when plugin is uninstalled
   */
  uninstall?: (client: DorisioClient) => Promise<void> | void;
  /**
   * Register hooks for lifecycle events
   */
  hooks?: Partial<Record<PluginHook, PluginHookHandler>>;
  /**
   * Plugin-specific configuration or state
   */
  config?: Record<string, unknown>;
}

/**
 * Installed plugin metadata
 */
export interface InstalledPlugin {
  plugin: Plugin;
  installedAt: Date;
}

/**
 * Plugin composition result
 */
export interface PluginCompositionResult {
  plugin: Plugin;
  isComposite: boolean;
  dependencies: string[];
}

/**
 * Plugin registry and management
 */
export class PluginSystem {
  private plugins = new Map<string, InstalledPlugin>();
  private hooks = new Map<PluginHook, PluginHookHandler[]>();
  private client?: DorisioClient;

  constructor() {
    // Initialize hook storage
    Object.values(PluginHook).forEach((hook) => {
      this.hooks.set(hook, []);
    });
  }

  /**
   * Initialize plugin system with client
   */
  async initialize(client: DorisioClient): Promise<void> {
    this.client = client;
    await this.emit(PluginHook.BeforeInit);
    await this.emit(PluginHook.AfterInit);
  }

  /**
   * Install a plugin
   */
  async install(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already installed`);
    }

    // Call plugin install hook if available
    if (plugin.install && this.client) {
      await plugin.install(this.client);
    }

    // Register plugin hooks
    if (plugin.hooks) {
      Object.entries(plugin.hooks).forEach(([hookName, handler]) => {
        const hook = hookName as PluginHook;
        if (this.hooks.has(hook)) {
          this.hooks.get(hook)!.push(handler);
        }
      });
    }

    // Store plugin metadata
    this.plugins.set(plugin.name, {
      plugin,
      installedAt: new Date(),
    });
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginName: string): Promise<void> {
    const installed = this.plugins.get(pluginName);
    if (!installed) {
      throw new Error(`Plugin "${pluginName}" is not installed`);
    }

    const { plugin } = installed;

    // Call plugin uninstall hook if available
    if (plugin.uninstall && this.client) {
      await plugin.uninstall(this.client);
    }

    // Remove plugin hooks
    if (plugin.hooks) {
      Object.keys(plugin.hooks).forEach((hookName) => {
        const hook = hookName as PluginHook;
        const handlers = this.hooks.get(hook) || [];
        const handlerIndex = handlers.indexOf(plugin.hooks![hook]!);
        if (handlerIndex >= 0) {
          handlers.splice(handlerIndex, 1);
        }
      });
    }

    // Remove plugin from registry
    this.plugins.delete(pluginName);
  }

  /**
   * Get installed plugin
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  /**
   * Get all installed plugins
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).map((installed) => installed.plugin);
  }

  /**
   * Check if plugin is installed
   */
  isPluginInstalled(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Emit a hook event to all registered handlers
   */
  async emit(hook: PluginHook, context?: Partial<PluginHookContext>): Promise<void> {
    const handlers = this.hooks.get(hook) || [];
    const fullContext: PluginHookContext = {
      timestamp: Date.now(),
      ...context,
    };

    for (const handler of handlers) {
      try {
        await handler(fullContext);
      } catch (error) {
        console.error(`Error in plugin hook ${hook}:`, error);
      }
    }
  }

  /**
   * Compose multiple plugins into a single plugin
   */
  compose(plugins: Plugin[], name: string): PluginCompositionResult {
    const composedPlugin: Plugin = {
      name,
      description: `Composite plugin containing: ${plugins.map((p) => p.name).join(', ')}`,
      hooks: {},
    };

    plugins.forEach((plugin) => {
      if (plugin.hooks) {
        Object.entries(plugin.hooks).forEach(([hookName, handler]) => {
          const hook = hookName as PluginHook;
          if (!composedPlugin.hooks![hook]) {
            composedPlugin.hooks![hook] = handler;
          }
        });
      }
    });

    return {
      plugin: composedPlugin,
      isComposite: true,
      dependencies: plugins.map((p) => p.name),
    };
  }

  /**
   * Get plugin statistics
   */
  getStats(): {
    totalPlugins: number;
    hookCount: Map<PluginHook, number>;
  } {
    const hookCount = new Map<PluginHook, number>();
    this.hooks.forEach((handlers, hook) => {
      hookCount.set(hook, handlers.length);
    });

    return {
      totalPlugins: this.plugins.size,
      hookCount,
    };
  }

  /**
   * Clear all plugins (usually for testing)
   */
  async clear(): Promise<void> {
    const pluginNames = Array.from(this.plugins.keys());
    for (const name of pluginNames) {
      await this.uninstall(name);
    }
  }

  /**
   * Shutdown plugin system
   */
  async shutdown(): Promise<void> {
    await this.emit(PluginHook.BeforeShutdown);
    await this.clear();
    await this.emit(PluginHook.AfterShutdown);
  }
}
