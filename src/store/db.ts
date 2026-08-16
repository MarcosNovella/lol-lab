import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/**
 * SQLite cache. Uses Node's built-in `node:sqlite` (ADR-003) so there is no native module to
 * rebuild and no dependency to keep current.
 *
 * The schema is applied on every open and every statement in it is idempotent, which means
 * "migration" is just editing schema.sql — fine at this size, and there is no other consumer
 * of the file to coordinate with.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..', '..');
const SCHEMA_PATH = join(HERE, 'schema.sql');

export const DEFAULT_DB_PATH = join(PROJECT_ROOT, 'data', 'riot.db');

export type Db = DatabaseSync;

export function openDb(path: string = DEFAULT_DB_PATH): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
