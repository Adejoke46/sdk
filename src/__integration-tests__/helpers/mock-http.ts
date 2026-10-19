import { expect, vi } from 'vitest';

import { HttpMethod } from './enums';

export type RequestMethod = `${HttpMethod}` | HttpMethod;

export type MockRequestArgs = [RequestMethod, string, unknown?, unknown?];

export type RouteHandler = (
  method: RequestMethod,
  path: string,
  body?: unknown
) => unknown | Promise<unknown>;

export interface RouteRule {
  method: RequestMethod;
  path: string | RegExp;
  handler: RouteHandler;
}

function matchesPath(rulePath: string | RegExp, path: string): boolean {
  if (typeof rulePath === 'string') {
    return rulePath === path;
  }

  return rulePath.test(path);
}

export class StatefulMockHttp {
  readonly request = vi.fn(
    async (method: RequestMethod, path: string, body?: unknown): Promise<unknown> => {
      this.callLog.push([method, path, body]);

      const rule = this.rules.find(
        (candidate) =>
          candidate.method === method && matchesPath(candidate.path, path)
      );

      if (!rule) {
        throw new Error(`Unhandled mock request: ${method} ${path}`);
      }

      return rule.handler(method, path, body);
    }
  );

  private readonly rules: RouteRule[] = [];
  private readonly callLog: MockRequestArgs[] = [];

  on(method: RequestMethod, path: string | RegExp, handler: RouteHandler): this {
    this.rules.push({ method, path, handler });
    return this;
  }

  reset(): void {
    this.rules.length = 0;
    this.callLog.length = 0;
    this.request.mockClear();
  }

  getCalls(): readonly MockRequestArgs[] {
    return this.callLog;
  }

  getPaths(): string[] {
    return this.callLog.map(([, path]) => path);
  }

  getCallCount(method: RequestMethod, path: string | RegExp): number {
    return this.callLog.filter(
      ([callMethod, callPath]) =>
        callMethod === method && matchesPath(path, callPath)
    ).length;
  }

  assertCallOrder(expectedPaths: string[]): void {
    expect(this.getPaths()).toEqual(expectedPaths);
  }

  wasCalledWith(method: RequestMethod, path: string | RegExp): boolean {
    return this.callLog.some(
      ([callMethod, callPath]) =>
        callMethod === method && matchesPath(path, callPath)
    );
  }
}
