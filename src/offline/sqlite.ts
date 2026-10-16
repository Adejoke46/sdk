/**
 * SQLite Storage Entry Point (Node.js only)
 *
 * This entry point is for Node.js environments only. It exports SQLiteStorage
 * which depends on better-sqlite3. Do not import this in browser code.
 *
 * Usage (Node.js):
 *   import { SQLiteStorage } from 'dorisio-sdk/offline/sqlite';
 */

export { SQLiteStorage } from './storage';
export type { StorageBackendOptions } from '../types/offline';
