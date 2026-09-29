// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DorisioClient } from '../client';
import { DorisioProvider, isDorisioContext, requireDorisioContext, useDorisio } from './DorisioProvider';

describe('DorisioProvider context safety', () => {
  it('throws a clear error when a hook is rendered outside the provider', () => {
    expect(() => renderHook(() => useDorisio())).toThrow('useDorisio must be used within DorisioProvider');
  });
  it('provides a non-null, narrowed context to consumers', () => {
    const client = new DorisioClient({ baseUrl: 'https://example.test', mode: 'sandbox' });
    const { result } = renderHook(() => useDorisio(), { wrapper: ({ children }) => <DorisioProvider client={client} config={client.getConfig()}>{children}</DorisioProvider> });
    expect(isDorisioContext(result.current)).toBe(true);
    expect(requireDorisioContext(result.current).client).toBe(client);
  });
});
