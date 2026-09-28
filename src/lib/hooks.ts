/**
 * Hook System
 *
 * Provides beforeRequest / afterRequest / beforeResponse / afterResponse hooks
 * for deep customization of the request/response lifecycle.
 */

export interface HookContext {
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Request body (mutable) */
  body?: unknown;
  /** Request headers (mutable) */
  headers?: Record<string, string>;
  /** Unique request id */
  requestId?: string;
  /** Arbitrary state bag shared across hooks in the same request */
  state: Record<string, unknown>;
}

export interface ResponseContext {
  /** HTTP status code */
  status: number;
  /** Response body (mutable) */
  body?: unknown;
  /** Response headers */
  headers?: Record<string, string>;
  /** Request context that produced this response */
  request: HookContext;
  /** Arbitrary state bag */
  state: Record<string, unknown>;
}

export type BeforeRequestHook = (ctx: HookContext) => Promise<HookContext | void> | HookContext | void;
export type AfterRequestHook = (ctx: HookContext) => Promise<void> | void;
export type BeforeResponseHook = (ctx: ResponseContext) => Promise<ResponseContext | void> | ResponseContext | void;
export type AfterResponseHook = (ctx: ResponseContext) => Promise<void> | void;

export interface HookRegistration {
  name: string;
  beforeRequest?: BeforeRequestHook;
  afterRequest?: AfterRequestHook;
  beforeResponse?: BeforeResponseHook;
  afterResponse?: AfterResponseHook;
}

export class HookManager {
  private hooks: HookRegistration[] = [];

  /**
   * Register a hook with any combination of lifecycle callbacks.
   */
  register(hook: HookRegistration): void {
    this.hooks.push(hook);
  }

  /**
   * Unregister a hook by name.
   */
  unregister(name: string): void {
    this.hooks = this.hooks.filter((h) => h.name !== name);
  }

  /**
   * Check if a hook is registered.
   */
  has(name: string): boolean {
    return this.hooks.some((h) => h.name === name);
  }

  /**
   * Execute all beforeRequest hooks in order.
   * Returns the (potentially modified) context.
   */
  async executeBeforeRequest(ctx: HookContext): Promise<HookContext> {
    let current = { ...ctx, state: { ...ctx.state } };
    for (const hook of this.hooks) {
      if (hook.beforeRequest) {
        const result = await hook.beforeRequest(current);
        if (result) {
          current = { ...current, ...result, state: { ...current.state, ...result.state } };
        }
      }
    }
    return current;
  }

  /**
   * Execute all afterRequest hooks in order.
   */
  async executeAfterRequest(ctx: HookContext): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterRequest) {
        await hook.afterRequest({ ...ctx, state: { ...ctx.state } });
      }
    }
  }

  /**
   * Execute all beforeResponse hooks in order.
   * Returns the (potentially modified) context.
   */
  async executeBeforeResponse(ctx: ResponseContext): Promise<ResponseContext> {
    let current = { ...ctx, state: { ...ctx.state } };
    for (const hook of this.hooks) {
      if (hook.beforeResponse) {
        const result = await hook.beforeResponse(current);
        if (result) {
          current = { ...current, ...result, state: { ...current.state, ...result.state } };
        }
      }
    }
    return current;
  }

  /**
   * Execute all afterResponse hooks in order.
   */
  async executeAfterResponse(ctx: ResponseContext): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterResponse) {
        await hook.afterResponse({ ...ctx, state: { ...ctx.state } });
      }
    }
  }

  /**
   * Remove all registered hooks.
   */
  clear(): void {
    this.hooks = [];
  }
}
