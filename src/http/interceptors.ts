/**
 * Request/Response Interceptors
 *
 * Allows hooks into request and response lifecycle.
 *
 * ## Execution phases
 *
 * Interceptors are grouped by lifecycle phase. Every interceptor in a phase
 * runs to completion (awaited) before the next one starts, so execution within
 * a phase is strictly **FIFO in registration order**. Interceptor ids are
 * monotonically increasing and stable for the lifetime of the manager, which
 * makes removal deterministic.
 *
 * ```text
 * request() ──▶ pre-request  ──▶ post-request ──▶ fetch / sandbox mock ──▶
 *                                                       │
 *                                            success ───▶ pre-response ──▶ post-response ──▶ caller
 *                                            failure ───────────────────▶ error interceptors ───▶ throw
 * ```
 *
 * - **pre-request** — request interceptors (`addRequestInterceptor`) run once
 *   before the request is sent. They receive `RequestOptions`, may mutate it,
 *   and the final returned value is what actually gets sent.
 * - **post-request** — the request has been handed to the transport (fetch or
 *   the sandbox mock router). This is the boundary between the request and
 *   response phases; no interceptor runs here.
 * - **pre-response** — response interceptors (`addResponseInterceptor`) run
 *   after a successful response, before the payload is delivered to the caller.
 *   Each returned value is passed to the next interceptor.
 * - **post-response** — the (possibly transformed) payload is delivered to the
 *   caller; response execution is complete.
 *
 * On failure, error interceptors (`addErrorInterceptor`) run in registration
 * order before the retry loop decides whether to retry.
 *
 * ## Ordering guarantees
 *
 * - All interceptors of the same phase execute in registration order (FIFO).
 *   `Map` preserves insertion order, so `execute*Interceptors` iterates in
 *   the order interceptors were added; lower ids run first.
 * - Removal is by id only (`remove*Interceptor`). There is no arbitrary
 *   reorder API; to move an interceptor, remove it and re-add it — it then
 *   runs last in its phase.
 */

import type { RequestOptions } from './http-client';
import type {
  ErrorInterceptor,
  InterceptorId,
  RequestInterceptor,
  ResponseInterceptor,
} from '../types/interceptors';

export type {
  ErrorInterceptor,
  InterceptorId,
  RequestInterceptor,
  ResponseInterceptor,
} from '../types/interceptors';

export class InterceptorManager {
  private requestInterceptors = new Map<InterceptorId, RequestInterceptor>();
  private responseInterceptors = new Map<InterceptorId, ResponseInterceptor>();
  private errorInterceptors = new Map<InterceptorId, ErrorInterceptor>();
  private nextInterceptorId = 0;

  /**
   * Add request interceptor
   *
   * Runs in the **pre-request** phase, before the request is sent, in
   * registration order (FIFO). Returns a stable id usable with
   * {@link removeRequestInterceptor}.
   */
  addRequestInterceptor(interceptor: RequestInterceptor): InterceptorId {
    const id = ++this.nextInterceptorId;
    this.requestInterceptors.set(id, interceptor);
    return id;
  }

  /**
   * Remove a request interceptor by id.
   *
   * Returns `true` if an interceptor was removed, `false` if the id is unknown.
   * Remaining interceptors keep their relative registration order.
   */
  removeRequestInterceptor(id: InterceptorId): boolean {
    return this.requestInterceptors.delete(id);
  }

  /**
   * Add response interceptor
   *
   * Runs in the **pre-response** phase, after a successful response and before
   * the payload is delivered to the caller, in registration order (FIFO).
   * Returns a stable id usable with {@link removeResponseInterceptor}.
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): InterceptorId {
    const id = ++this.nextInterceptorId;
    this.responseInterceptors.set(id, interceptor);
    return id;
  }

  /**
   * Remove a response interceptor by id.
   *
   * Returns `true` if an interceptor was removed, `false` if the id is unknown.
   */
  removeResponseInterceptor(id: InterceptorId): boolean {
    return this.responseInterceptors.delete(id);
  }

  /**
   * Add error interceptor
   *
   * Runs on failure, before the retry loop decides whether to retry, in
   * registration order (FIFO). Returns a stable id usable with
   * {@link removeErrorInterceptor}.
   */
  addErrorInterceptor(interceptor: ErrorInterceptor): InterceptorId {
    const id = ++this.nextInterceptorId;
    this.errorInterceptors.set(id, interceptor);
    return id;
  }

  /**
   * Remove an error interceptor by id.
   *
   * Returns `true` if an interceptor was removed, `false` if the id is unknown.
   */
  removeErrorInterceptor(id: InterceptorId): boolean {
    return this.errorInterceptors.delete(id);
  }

  /**
   * Execute request interceptors (**pre-request** phase)
   *
   * Runs all request interceptors in registration order, awaiting each one.
   * Each returned `RequestOptions` is passed to the next interceptor.
   */
  async executeRequestInterceptors(options: RequestOptions): Promise<RequestOptions> {
    let result = options;
    for (const interceptor of this.requestInterceptors.values()) {
      result = await interceptor(result);
    }
    return result;
  }

  /**
   * Execute response interceptors (**pre-response** phase)
   *
   * Runs all response interceptors in registration order, awaiting each one.
   * Each returned value is passed to the next interceptor.
   */
  async executeResponseInterceptors<T>(response: T): Promise<T> {
    let result = response;
    for (const interceptor of this.responseInterceptors.values()) {
      result = await interceptor(result);
    }
    return result;
  }

  /**
   * Execute error interceptors
   *
   * Runs all error interceptors in registration order, awaiting each one.
   * Interceptors are observational: a `undefined` return leaves the error
   * unchanged; otherwise the returned value replaces it for downstream
   * handling.
   */
  async executeErrorInterceptors(error: unknown): Promise<unknown> {
    let result = error;
    for (const interceptor of this.errorInterceptors.values()) {
      const next = await interceptor(result);
      if (next !== undefined) {
        result = next;
      }
    }
    return result;
  }

  /**
   * #48 - Remove all registered interceptors and release closure references.
   *
   * Call this when the owning HttpClient is no longer needed (e.g. on logout
   * or in test teardown) to prevent long-lived interceptor closures from
   * retaining references to auth tokens, loggers, or other large objects.
   */
  cleanup(): void {
    this.requestInterceptors.clear();
    this.responseInterceptors.clear();
    this.errorInterceptors.clear();
  }

  /**
   * Return the number of registered interceptors of each type.
   * Useful for tests and diagnostics.
   */
  getCount(): { request: number; response: number; error: number } {
    return {
      request: this.requestInterceptors.size,
      response: this.responseInterceptors.size,
      error: this.errorInterceptors.size,
    };
  }
}
