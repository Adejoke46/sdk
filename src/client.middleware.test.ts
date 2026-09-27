/**
 * Middleware tests for request/response transformation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DorisioClient } from './client';
import type { MiddlewareContext } from './types/errors';

describe('Client middleware', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('transforms request before sending', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
    });

    let capturedBody: Record<string, unknown> = {};
    client.use((ctx, next) => {
      if (ctx.body && typeof ctx.body === 'object') {
        ctx.body = { ...ctx.body, timestamp: '2024-01-01' };
        capturedBody = ctx.body as Record<string, unknown>;
      }
      return next();
    });

    await client.request('POST', '/api/v1/data', { value: 'test' });

    expect(capturedBody).toEqual({ value: 'test', timestamp: '2024-01-01' });
  });

  it('transforms response after receiving', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
    });

    client.use(async (ctx, next) => {
      const response = (await next()) as { data?: { transformed?: boolean } };
      if (response.data && typeof response.data === 'object') {
        response.data.transformed = true;
      }
      return response;
    });

    const result = await client.request('GET', '/api/v1/data');

    expect((result.data as { transformed?: boolean }).transformed).toBe(true);
  });

  it('executes middleware in correct order', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
    });

    const executionOrder: string[] = [];

    client.use(async (ctx, next) => {
      executionOrder.push('middleware1-before');
      const result = await next();
      executionOrder.push('middleware1-after');
      return result;
    });

    client.use(async (ctx, next) => {
      executionOrder.push('middleware2-before');
      const result = await next();
      executionOrder.push('middleware2-after');
      return result;
    });

    await client.request('GET', '/api/v1/data');

    expect(executionOrder).toEqual([
      'middleware1-before',
      'middleware2-before',
      'middleware2-after',
      'middleware1-after',
    ]);
  });

  it('supports async middleware', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
    });

    client.use(async (ctx, next) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (ctx.body && typeof ctx.body === 'object') {
        ctx.body = { ...ctx.body, asyncProcessed: true };
      }
      return next();
    });

    const promise = client.request('POST', '/api/v1/data', { value: 'test' });
    await vi.runAllTimersAsync();
    await promise;
  });

  it('handles errors in middleware', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
    });

    client.use(async () => {
      throw new Error('Middleware error');
    });

    await expect(client.request('GET', '/api/v1/data')).rejects.toThrow('Middleware error');
  });

  it('allows middleware to short-circuit requests', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
    });

    client.use(async () => {
      return { cached: true, fromCache: true };
    });

    const result = await client.request('GET', '/api/v1/data');

    expect(result).toEqual({ cached: true, fromCache: true });
  });

  it('provides context to middleware', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
    });

    let capturedContext: MiddlewareContext = {
      method: 'GET',
      path: '',
    };
    client.use(async (ctx, next) => {
      capturedContext = ctx;
      return next();
    });

    await client.request('POST', '/api/v1/data', { test: 'value' }, { headers: { 'X-Custom': 'header' } });

    expect(capturedContext).toMatchObject({
      method: 'POST',
      path: '/api/v1/data',
      body: { test: 'value' },
      headers: { 'X-Custom': 'header' },
    });
  });

  it('supports multiple middleware registration', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
    });

    const executionOrder: string[] = [];
    client.use((ctx, next) => {
      if (ctx.body && typeof ctx.body === 'object') {
        ctx.body = { ...ctx.body, step1: true };
      }
      executionOrder.push('middleware1');
      return next();
    });

    client.use((ctx, next) => {
      if (ctx.body && typeof ctx.body === 'object') {
        ctx.body = { ...ctx.body, step2: true };
      }
      executionOrder.push('middleware2');
      return next();
    });

    await client.request('POST', '/api/v1/data', { original: true });

    expect(executionOrder).toEqual(['middleware1', 'middleware2']);
  });
});
