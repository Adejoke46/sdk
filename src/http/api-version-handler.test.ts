import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiVersionHandler } from './api-version-handler';

describe('ApiVersionHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('version management & fallback', () => {
    it('initializes with default version v1', () => {
      const handler = new ApiVersionHandler();
      expect(handler.getCurrentVersion()).toBe('v1');
      expect(handler.getSupportedVersions()).toContain('v1');
      expect(handler.getFallbackVersion()).toBe('v1');
    });

    it('initializes with custom current and supported versions', () => {
      const handler = new ApiVersionHandler({
        currentVersion: 'v2',
        supportedVersions: ['v1', 'v2', 'v3'],
        fallbackVersion: 'v1',
      });
      expect(handler.getCurrentVersion()).toBe('v2');
      expect(handler.getSupportedVersions()).toEqual(['v1', 'v2', 'v3']);
      expect(handler.getFallbackVersion()).toBe('v1');
    });

    it('sets current version if supported', () => {
      const onVersionChange = vi.fn();
      const handler = new ApiVersionHandler({
        currentVersion: 'v1',
        supportedVersions: ['v1', 'v2'],
        onVersionChange,
      });

      handler.setCurrentVersion('v2');
      expect(handler.getCurrentVersion()).toBe('v2');
      expect(onVersionChange).toHaveBeenCalledWith('v1', 'v2');
    });

    it('falls back to fallbackVersion when unsupported version is set', () => {
      const logger = vi.fn();
      const handler = new ApiVersionHandler({
        currentVersion: 'v2',
        supportedVersions: ['v1', 'v2'],
        fallbackVersion: 'v1',
        logger,
      });

      handler.setCurrentVersion('v99');
      expect(handler.getCurrentVersion()).toBe('v1');
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining("API version 'v99' is not supported. Falling back to 'v1'.")
      );
    });

    it('allows adding supported versions dynamically', () => {
      const handler = new ApiVersionHandler({ currentVersion: 'v1' });
      expect(handler.isVersionSupported('v2')).toBe(false);

      handler.addSupportedVersion('v2');
      expect(handler.isVersionSupported('v2')).toBe(true);
      handler.setCurrentVersion('v2');
      expect(handler.getCurrentVersion()).toBe('v2');
    });
  });

  describe('header detection', () => {
    it('detects version from plain headers object (case-insensitive)', () => {
      const handler = new ApiVersionHandler();

      expect(handler.detectVersionFromHeaders({ 'API-Version': 'v2' })).toBe('v2');
      expect(handler.detectVersionFromHeaders({ 'api-version': 'v3' })).toBe('v3');
      expect(handler.detectVersionFromHeaders({ 'X-API-Version': '2024-01-01' })).toBe('2024-01-01');
      expect(handler.detectVersionFromHeaders({ 'x-api-version': 'v2' })).toBe('v2');
      expect(handler.detectVersionFromHeaders({ 'content-type': 'application/json' })).toBeUndefined();
    });

    it('detects version from Headers instance', () => {
      const handler = new ApiVersionHandler();
      const headers = new Headers();
      headers.set('API-Version', 'v2.1');

      expect(handler.detectVersionFromHeaders(headers)).toBe('v2.1');
    });

    it('updates current version when response header detected', () => {
      const onVersionChange = vi.fn();
      const handler = new ApiVersionHandler({
        currentVersion: 'v1',
        supportedVersions: ['v1', 'v2'],
        onVersionChange,
      });

      const result = handler.checkResponseHeaders({ 'API-Version': 'v2' });
      expect(result.detectedVersion).toBe('v2');
      expect(handler.getCurrentVersion()).toBe('v2');
      expect(onVersionChange).toHaveBeenCalledWith('v1', 'v2');
    });
  });

  describe('deprecation detection & warnings', () => {
    it('detects deprecation from response headers', () => {
      const onDeprecation = vi.fn();
      const handler = new ApiVersionHandler({
        currentVersion: 'v1',
        onDeprecation,
      });

      const res = handler.checkResponseHeaders(
        {
          deprecation: 'true',
          sunset: '2026-12-31',
          'API-Version': 'v1',
        },
        '/api/v1/legacy'
      );

      expect(res.isDeprecated).toBe(true);
      expect(onDeprecation).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: '/api/v1/legacy',
          version: 'v1',
          sunsetDate: '2026-12-31',
        })
      );
    });

    it('warns on pre-configured deprecated endpoints', () => {
      const onDeprecation = vi.fn();
      const handler = new ApiVersionHandler({
        deprecatedEndpoints: [
          {
            endpoint: '/api/v1/creators/legacy',
            sunsetDate: '2026-10-01',
            alternative: '/api/v2/creators',
          },
        ],
        onDeprecation,
      });

      handler.checkEndpointDeprecation('/api/v1/creators/legacy');
      expect(onDeprecation).toHaveBeenCalledTimes(1);
      expect(onDeprecation).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: '/api/v1/creators/legacy',
          alternative: '/api/v2/creators',
          sunsetDate: '2026-10-01',
        })
      );

      // Subsequent check should deduplicate warning
      handler.checkEndpointDeprecation('/api/v1/creators/legacy');
      expect(onDeprecation).toHaveBeenCalledTimes(1);
    });

    it('matches parameterized deprecated endpoints', () => {
      const onDeprecation = vi.fn();
      const handler = new ApiVersionHandler({
        deprecatedEndpoints: [
          {
            endpoint: '/api/v1/users/:userId/old-data',
            message: 'Old data route is deprecated',
          },
        ],
        onDeprecation,
      });

      handler.checkEndpointDeprecation('/api/v1/users/usr_123/old-data');
      expect(onDeprecation).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Old data route is deprecated',
        })
      );
    });
  });

  describe('request and response migration', () => {
    it('injects API-Version header into request', () => {
      const handler = new ApiVersionHandler({ currentVersion: 'v1' });
      const req = handler.migrateRequest({
        method: 'GET',
        path: '/api/v1/users',
      });

      expect(req.headers?.['API-Version']).toBe('v1');
    });

    it('executes registered request migrations across version steps', () => {
      const handler = new ApiVersionHandler({
        currentVersion: 'v2',
        supportedVersions: ['v1', 'v2'],
      });

      handler.registerMigration({
        fromVersion: 'v1',
        toVersion: 'v2',
        migrateRequest: (req) => ({
          ...req,
          path: req.path.replace('/api/v1/', '/api/v2/'),
          body: {
            ...((req.body as Record<string, unknown>) || {}),
            migratedV2: true,
          },
        }),
      });

      const migrated = handler.migrateRequest({
        method: 'POST',
        path: '/api/v1/checkout',
        body: { amount: 100 },
      });

      expect(migrated.path).toBe('/api/v2/checkout');
      expect(migrated.body).toEqual({ amount: 100, migratedV2: true });
      expect(migrated.headers?.['API-Version']).toBe('v2');
    });

    it('migrates response data across version chain', () => {
      const handler = new ApiVersionHandler({
        currentVersion: 'v3',
        supportedVersions: ['v1', 'v2', 'v3'],
      });

      handler.registerMigration({
        fromVersion: 'v1',
        toVersion: 'v2',
        migrateResponse: (data) => ({
          ...(data as Record<string, unknown>),
          v2Field: 'added',
        }),
      });

      handler.registerMigration({
        fromVersion: 'v2',
        toVersion: 'v3',
        migrateResponse: (data) => ({
          ...(data as Record<string, unknown>),
          v3Field: 'completed',
        }),
      });

      const initialData = { id: 1, name: 'Alice' };
      const migrated = handler.migrateResponse(initialData, 'v1', 'v3');

      expect(migrated).toEqual({
        id: 1,
        name: 'Alice',
        v2Field: 'added',
        v3Field: 'completed',
      });
    });

    it('skips migration when autoMigrate is disabled', () => {
      const handler = new ApiVersionHandler({
        currentVersion: 'v2',
        autoMigrate: false,
      });

      handler.registerMigration({
        fromVersion: 'v1',
        toVersion: 'v2',
        migrateRequest: (req) => ({
          ...req,
          path: '/api/v2/new',
        }),
      });

      const req = handler.migrateRequest({
        method: 'GET',
        path: '/api/v1/old',
      });

      expect(req.path).toBe('/api/v1/old');
      expect(req.headers?.['API-Version']).toBe('v2');
    });
  });
});
