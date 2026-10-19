/**
 * Debug value formatter for React DevTools hook inspection.
 *
 * Pretty-prints hook state values for DevTools while avoiding sensitive data
 * (tokens, keys, secrets, emails, public keys) and keeping payloads small.
 */

type DebugValue = string | number | boolean | null | undefined;

function isSensitiveKey(key: string): boolean {
  const sensitive = /token|secret|password|key|credential|private|auth|signature|email/i;
  return sensitive.test(key);
}

function redactValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') {
    if (value.length > 40) return `"${value.slice(0, 20)}…(${value.length - 40} more)"`;
    return `"${value}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '[object]';
}

function formatObject(obj: Record<string, unknown>, depth: number = 0): string {
  const indent = '  '.repeat(depth);
  const entries = Object.entries(obj);

  if (entries.length === 0) return '{}';

  const parts = entries.map(([key, val]) => {
    if (isSensitiveKey(key)) {
      return `${indent}  ${key}: [redacted]`;
    }
    if (val === null || val === undefined) {
      return `${indent}  ${key}: ${String(val)}`;
    }
    if (typeof val === 'string') {
      return `${indent}  ${key}: ${redactValue(val)}`;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
      return `${indent}  ${key}: ${String(val)}`;
    }
    if (Array.isArray(val)) {
      return `${indent}  ${key}: [${val.length} items]`;
    }
    if (typeof val === 'object') {
      return `${indent}  ${key}: {${formatObject(val as Record<string, unknown>, depth + 1)}}`;
    }
    return `${indent}  ${key}: [${typeof val}]`;
  });

  return `{\n${parts.join(',\n')}\n${indent}}`;
}

/** Format hook state for DevTools display. Truncates arrays and redacts sensitive keys. */
export function formatDebugValue(value: unknown): DebugValue {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (typeof value === 'object') {
    return formatObject(value as Record<string, unknown>);
  }
  return String(value);
}
