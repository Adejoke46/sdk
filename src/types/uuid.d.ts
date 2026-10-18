/**
 * Minimal type declaration for uuid v9 (no @types/uuid installed).
 * uuid v9+ ships its own bundled types; this shim covers environments
 * where they are not resolved by the compiler.
 */
declare module 'uuid' {
  export function v4(): string;
  export function v1(): string;
  export function v3(name: string, namespace: string): string;
  export function v5(name: string, namespace: string): string;
  export function validate(uuid: string): boolean;
  export function version(uuid: string): number;
}
