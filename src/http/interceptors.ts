/**
 * Request/Response Interceptors
 *
 * Allows hooks into request and response lifecycle.
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
   */
  addRequestInterceptor(interceptor: RequestInterceptor): InterceptorId {
    const id = ++this.nextInterceptorId;
    this.requestInterceptors.set(id, interceptor);
    return id;
  }

  removeRequestInterceptor(id: InterceptorId): boolean {
    return this.requestInterceptors.delete(id);
  }

  /**
   * Add response interceptor
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): InterceptorId {
    const id = ++this.nextInterceptorId;
    this.responseInterceptors.set(id, interceptor);
    return id;
  }

  removeResponseInterceptor(id: InterceptorId): boolean {
    return this.responseInterceptors.delete(id);
  }

  /**
   * Add error interceptor
   */
  addErrorInterceptor(interceptor: ErrorInterceptor): InterceptorId {
    const id = ++this.nextInterceptorId;
    this.errorInterceptors.set(id, interceptor);
    return id;
  }

  removeErrorInterceptor(id: InterceptorId): boolean {
    return this.errorInterceptors.delete(id);
  }

  /**
   * Execute request interceptors
   */
  async executeRequestInterceptors(options: RequestOptions): Promise<RequestOptions> {
    let result = options;
    for (const interceptor of this.requestInterceptors.values()) {
      result = await interceptor(result);
    }
    return result;
  }

  /**
   * Execute response interceptors
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
