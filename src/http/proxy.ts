/**
 * Proxy configuration and rotation helpers.
 *
 * Supports a single proxy or round-robin rotation across multiple proxies,
 * optional basic auth, TLS rejection control, and URL-based bypass rules.
 */

export interface ProxyEntry {
  /** Proxy URL (e.g. 'http://proxy:8080') */
  url: string;
  /** Proxy auth username */
  username?: string;
  /** Proxy auth password */
  password?: string;
  /** Whether to reject unauthorized SSL certificates */
  rejectUnauthorized?: boolean;
}

export interface ProxyConfig {
  /** Single proxy URL or array of proxy URLs for round-robin rotation */
  url: string | string[];
  /** Proxy auth username (shared across all proxies) */
  username?: string;
  /** Proxy auth password (shared across all proxies) */
  password?: string;
  /** Whether to reject unauthorized SSL certificates */
  rejectUnauthorized?: boolean;
  /** URL patterns (strings or regexps) that bypass the proxy */
  bypass?: (string | RegExp)[];
}

/** Normalize a ProxyConfig into a flat array of proxy entries. */
export function normalizeProxyConfig(config: ProxyConfig): ProxyEntry[] {
  const urls = Array.isArray(config.url) ? config.url : [config.url];
  return urls.map((url) => ({
    url,
    username: config.username,
    password: config.password,
    rejectUnauthorized: config.rejectUnauthorized,
  }));
}

/** Select a proxy from the list using round-robin based on the request index. */
export function selectProxy(proxies: ProxyEntry[], index: number): ProxyEntry {
  return proxies[index % proxies.length];
}

/**
 * Check whether a URL should bypass the proxy.
 * String patterns match when the URL includes the pattern.
 * RegExp patterns match when they test against the URL.
 */
export function isBypassed(url: string, bypass?: (string | RegExp)[]): boolean {
  if (!bypass || bypass.length === 0) {
    return false;
  }
  return bypass.some((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern.test(url);
    }
    return url.includes(pattern);
  });
}

/** Build proxy-related headers for a single proxy entry. */
export function buildProxyHeaders(proxy: ProxyEntry): Record<string, string> {
  const headers: Record<string, string> = {};

  if (proxy.username && proxy.password) {
    const credentials = `${proxy.username}:${proxy.password}`;
    let token: string;
    if (typeof Buffer !== 'undefined') {
      token = Buffer.from(credentials).toString('base64');
    } else {
      token = btoa(unescape(encodeURIComponent(credentials)));
    }
    headers['Proxy-Authorization'] = `Basic ${token}`;
  }

  try {
    const host = new URL(proxy.url).host;
    headers['Via'] = `1.1 ${host}`;
  } catch {
    // Invalid proxy URL; omit the Via header.
  }

  return headers;
}
