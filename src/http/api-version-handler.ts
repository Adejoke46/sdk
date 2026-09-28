/**
 * API Version Handler
 *
 * Handles API version detection, request/response migration,
 * deprecation warnings, and version fallback strategies.
 */

export interface DeprecationWarning {
  endpoint?: string;
  version?: string;
  sunsetDate?: string;
  message: string;
  alternative?: string;
}

export interface DeprecatedEndpointConfig {
  endpoint: string;
  deprecatedInVersion?: string;
  sunsetDate?: string;
  alternative?: string;
  message?: string;
}

export interface RequestMigrationContext {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  apiVersion?: string;
}

export interface VersionMigration {
  fromVersion: string;
  toVersion: string;
  migrateRequest?: (req: RequestMigrationContext) => RequestMigrationContext;
  migrateResponse?: (data: unknown, context?: { path?: string; method?: string }) => unknown;
}

export interface ApiVersionHandlerOptions {
  currentVersion?: string;
  supportedVersions?: string[];
  fallbackVersion?: string;
  autoMigrate?: boolean;
  deprecatedEndpoints?: DeprecatedEndpointConfig[];
  onVersionChange?: (oldVersion: string, newVersion: string) => void;
  onDeprecation?: (warning: DeprecationWarning) => void;
  logger?: (message: string, data?: unknown) => void;
}

export class ApiVersionHandler {
  private currentVersion: string;
  private supportedVersions: Set<string>;
  private fallbackVersion: string;
  private autoMigrate: boolean;
  private migrations: VersionMigration[] = [];
  private deprecatedEndpoints: Map<string, DeprecatedEndpointConfig> = new Map();
  private warnedDeprecations: Set<string> = new Set();
  private onVersionChange?: (oldVersion: string, newVersion: string) => void;
  private onDeprecation?: (warning: DeprecationWarning) => void;
  private logger?: (message: string, data?: unknown) => void;

  constructor(options: ApiVersionHandlerOptions = {}) {
    this.currentVersion = options.currentVersion || 'v1';
    this.supportedVersions = new Set(
      options.supportedVersions && options.supportedVersions.length > 0
        ? options.supportedVersions
        : [this.currentVersion]
    );
    this.fallbackVersion = options.fallbackVersion || this.currentVersion;
    this.autoMigrate = options.autoMigrate ?? true;
    this.onVersionChange = options.onVersionChange;
    this.onDeprecation = options.onDeprecation;
    this.logger = options.logger;

    if (options.deprecatedEndpoints) {
      for (const ep of options.deprecatedEndpoints) {
        this.deprecatedEndpoints.set(this.normalizePath(ep.endpoint), ep);
      }
    }
  }

  getCurrentVersion(): string {
    return this.currentVersion;
  }

  setCurrentVersion(version: string): void {
    const resolved = this.resolveVersion(version);
    if (resolved !== this.currentVersion) {
      const previous = this.currentVersion;
      this.currentVersion = resolved;
      this.onVersionChange?.(previous, resolved);
    }
  }

  getSupportedVersions(): string[] {
    return Array.from(this.supportedVersions);
  }

  addSupportedVersion(version: string): void {
    this.supportedVersions.add(version);
  }

  isVersionSupported(version: string): boolean {
    return this.supportedVersions.has(version);
  }

  getFallbackVersion(): string {
    return this.fallbackVersion;
  }

  setFallbackVersion(version: string): void {
    this.fallbackVersion = version;
    this.supportedVersions.add(version);
  }

  resolveVersion(version?: string): string {
    if (!version) return this.currentVersion;
    if (this.isVersionSupported(version)) return version;
    this.logger?.(
      `[DORISIO] API version '${version}' is not supported. Falling back to '${this.fallbackVersion}'.`
    );
    return this.fallbackVersion;
  }

  registerMigration(migration: VersionMigration): void {
    this.migrations.push(migration);
    this.supportedVersions.add(migration.fromVersion);
    this.supportedVersions.add(migration.toVersion);
  }

  registerDeprecatedEndpoint(config: DeprecatedEndpointConfig): void {
    this.deprecatedEndpoints.set(this.normalizePath(config.endpoint), config);
  }

  detectVersionFromHeaders(
    headers?: Record<string, string | string[] | undefined> | Headers
  ): string | undefined {
    if (!headers) return undefined;

    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      return (
        headers.get('api-version') ||
        headers.get('API-Version') ||
        headers.get('x-api-version') ||
        headers.get('X-API-Version') ||
        undefined
      );
    }

    const entries = Object.entries(headers);
    for (const [key, value] of entries) {
      const lower = key.toLowerCase();
      if (lower === 'api-version' || lower === 'x-api-version') {
        if (Array.isArray(value)) return value[0];
        if (typeof value === 'string') return value;
      }
    }
    return undefined;
  }

  checkResponseHeaders(
    headers?: Record<string, string | string[] | undefined> | Headers,
    endpoint?: string
  ): { detectedVersion?: string; isDeprecated: boolean } {
    const detectedVersion = this.detectVersionFromHeaders(headers);

    let isDeprecated = false;
    let sunsetDate: string | undefined;
    let deprecationMessage = 'This API endpoint is deprecated and will be removed in a future release.';

    if (headers) {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        if (headers.get('deprecation') || headers.get('x-api-deprecated')) {
          isDeprecated = true;
        }
        sunsetDate = headers.get('sunset') || undefined;
      } else {
        for (const [key, value] of Object.entries(headers)) {
          const lower = key.toLowerCase();
          if (lower === 'deprecation' || lower === 'x-api-deprecated') {
            isDeprecated = value === 'true' || value === '1' || Boolean(value);
          }
          if (lower === 'sunset') {
            sunsetDate = Array.isArray(value) ? value[0] : value;
          }
        }
      }
    }

    if (endpoint) {
      const matched = this.findDeprecatedEndpoint(endpoint);
      if (matched) {
        isDeprecated = true;
        if (matched.sunsetDate) sunsetDate = matched.sunsetDate;
        if (matched.message) deprecationMessage = matched.message;
      }
    }

    if (detectedVersion && detectedVersion !== this.currentVersion) {
      this.setCurrentVersion(detectedVersion);
    }

    if (isDeprecated) {
      this.warnDeprecation({
        endpoint,
        version: detectedVersion || this.currentVersion,
        sunsetDate,
        message: deprecationMessage,
      });
    }

    return { detectedVersion, isDeprecated };
  }

  checkEndpointDeprecation(endpoint: string): void {
    const matched = this.findDeprecatedEndpoint(endpoint);
    if (matched) {
      this.warnDeprecation({
        endpoint,
        version: matched.deprecatedInVersion || this.currentVersion,
        sunsetDate: matched.sunsetDate,
        message:
          matched.message ||
          `Endpoint '${endpoint}' is deprecated${matched.alternative ? `. Use '${matched.alternative}' instead.` : '.'}`,
        alternative: matched.alternative,
      });
    }
  }

  warnDeprecation(warning: DeprecationWarning): void {
    const key = `${warning.endpoint || '*'}:${warning.version || '*'}:${warning.message}`;
    if (this.warnedDeprecations.has(key)) return;
    this.warnedDeprecations.add(key);

    const formatted = `[DORISIO DEPRECATION WARNING] ${warning.message}${
      warning.endpoint ? ` (Endpoint: ${warning.endpoint})` : ''
    }${warning.version ? ` (Version: ${warning.version})` : ''}${
      warning.sunsetDate ? ` [Sunset: ${warning.sunsetDate}]` : ''
    }${warning.alternative ? ` -> Alternative: ${warning.alternative}` : ''}`;

    if (this.logger) {
      this.logger(formatted, warning);
    } else {
      console.warn(formatted);
    }

    this.onDeprecation?.(warning);
  }

  clearDeprecationWarnings(): void {
    this.warnedDeprecations.clear();
  }

  migrateRequest(
    request: RequestMigrationContext,
    targetVersion?: string
  ): RequestMigrationContext {
    const desiredVersion = this.resolveVersion(targetVersion || this.currentVersion);
    const updatedHeaders: Record<string, string> = {
      ...(request.headers || {}),
      'API-Version': desiredVersion,
    };

    let currentReq: RequestMigrationContext = {
      ...request,
      headers: updatedHeaders,
      apiVersion: desiredVersion,
    };

    if (!this.autoMigrate) {
      return currentReq;
    }

    const currentReqVersion = request.apiVersion || this.extractVersionFromPath(request.path) || 'v1';
    if (currentReqVersion === desiredVersion) {
      return currentReq;
    }

    const chain = this.findMigrationChain(currentReqVersion, desiredVersion);
    for (const step of chain) {
      if (step.migrateRequest) {
        currentReq = step.migrateRequest(currentReq);
      }
    }

    if (!currentReq.headers?.['API-Version']) {
      currentReq.headers = {
        ...(currentReq.headers || {}),
        'API-Version': desiredVersion,
      };
    }

    return currentReq;
  }

  migrateResponse<T = unknown>(
    data: T,
    fromVersion: string,
    toVersion?: string,
    context?: { path?: string; method?: string }
  ): T {
    const targetVersion = toVersion || this.currentVersion;
    if (!this.autoMigrate || fromVersion === targetVersion) {
      return data;
    }

    const chain = this.findMigrationChain(fromVersion, targetVersion);
    let result: unknown = data;
    for (const step of chain) {
      if (step.migrateResponse) {
        result = step.migrateResponse(result, context);
      }
    }

    return result as T;
  }

  private findMigrationChain(from: string, to: string): VersionMigration[] {
    const queue: Array<{ version: string; chain: VersionMigration[] }> = [
      { version: from, chain: [] },
    ];
    const visited = new Set<string>([from]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      if (current.version === to) {
        return current.chain;
      }

      for (const migration of this.migrations) {
        if (migration.fromVersion === current.version && !visited.has(migration.toVersion)) {
          visited.add(migration.toVersion);
          queue.push({
            version: migration.toVersion,
            chain: [...current.chain, migration],
          });
        }
      }
    }

    return [];
  }

  private normalizePath(path: string): string {
    const base = path.split('?')[0] ?? '';
    return base.replace(/\/+$/, '') || '/';
  }

  private extractVersionFromPath(path: string): string | undefined {
    const match = path.match(/\/api\/(v\d+)/i);
    return match?.[1] ? match[1].toLowerCase() : undefined;
  }

  private findDeprecatedEndpoint(endpoint: string): DeprecatedEndpointConfig | undefined {
    const clean = this.normalizePath(endpoint);
    if (this.deprecatedEndpoints.has(clean)) {
      return this.deprecatedEndpoints.get(clean);
    }

    for (const [key, config] of this.deprecatedEndpoints.entries()) {
      if (key.includes(':') && this.matchRoute(key, clean)) {
        return config;
      }
    }
    return undefined;
  }

  private matchRoute(pattern: string, path: string): boolean {
    const patternSegments = pattern.split('/');
    const pathSegments = path.split('/');
    if (patternSegments.length !== pathSegments.length) return false;

    return patternSegments.every((segment, i) => {
      if (segment.startsWith(':')) return true;
      return segment === pathSegments[i];
    });
  }
}
