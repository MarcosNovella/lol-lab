import type { ItemRecord } from '../riot/ddragon.ts';
import { type Db, transaction } from './db.ts';

/**
 * The item catalogue, stored per Data Dragon version.
 *
 * Read paths take a VERSION and never a default: `catalogFor` returns null when a patch was
 * never fetched, so a caller has to decide what to do about it instead of being handed the
 * nearest table and a plausible wrong answer.
 */

export type ItemCatalog = Map<number, { name: string; goldTotal: number; finished: boolean }>;

export function saveItems(db: Db, items: ItemRecord[]): number {
  return transaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO items (item_id, version, name, gold_total, finished, tags)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (item_id, version) DO UPDATE SET
         name       = excluded.name,
         gold_total = excluded.gold_total,
         finished   = excluded.finished,
         tags       = excluded.tags`,
    );
    for (const item of items) {
      insert.run(
        item.itemId,
        item.version,
        item.name,
        item.goldTotal,
        item.finished ? 1 : 0,
        item.tags,
      );
    }
    return items.length;
  });
}

/** The catalogue for one version, or null when that version was never fetched. */
export function catalogFor(db: Db, version: string): ItemCatalog | null {
  const rows = db
    .prepare('SELECT item_id, name, gold_total, finished FROM items WHERE version = ?')
    .all(version) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const catalog: ItemCatalog = new Map();
  for (const row of rows) {
    catalog.set(Number(row['item_id']), {
      name: String(row['name']),
      goldTotal: Number(row['gold_total']),
      finished: Number(row['finished']) === 1,
    });
  }
  return catalog;
}

/**
 * The catalogue for a MATCH patch (`16.14`), found among the versions actually cached.
 *
 * The prefix join lives here rather than in the fetcher so that reading needs no network: Data
 * Dragon publishes `16.14.1` for match patch `16.14`, and occasionally a `.2`, so the newest
 * cached version with that prefix is the right table. A patch never fetched returns null, and
 * the caller says so instead of borrowing another patch's build paths.
 */
export function catalogForPatch(db: Db, patch: string): ItemCatalog | null {
  const row = db
    .prepare(
      `SELECT version FROM items WHERE version LIKE ? || '.%'
        ORDER BY version DESC LIMIT 1`,
    )
    .get(patch) as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  return catalogFor(db, String(row['version']));
}

/**
 * Whether a patch has a catalogue at all, without loading it.
 *
 * Same `LIKE patch || '.%'` predicate `catalogForPatch` uses, and shared on purpose: the panel
 * asks this to decide whether to offer the download, and a second, hand-rolled prefix check
 * would answer differently for a two-part version — "already have it" against a table that
 * `catalogForPatch` will not find.
 */
export function hasCatalogForPatch(db: Db, patch: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM items WHERE version LIKE ? || '.%' LIMIT 1")
    .get(patch) as Record<string, unknown> | undefined;
  return row !== undefined;
}

/** Which versions are cached, and how many items each holds. */
export function catalogVersions(db: Db): { version: string; items: number; finished: number }[] {
  const rows = db
    .prepare(
      `SELECT version, COUNT(*) AS items, SUM(finished) AS finished
         FROM items GROUP BY version ORDER BY version DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    version: String(r['version']),
    items: Number(r['items']),
    finished: Number(r['finished']),
  }));
}

/** The patches his cached matches were played on, newest first, with how many games each holds. */
export function patchesInCache(db: Db): { patch: string; games: number }[] {
  const rows = db
    .prepare(
      `SELECT patch, COUNT(*) AS games FROM matches
        WHERE patch IS NOT NULL GROUP BY patch ORDER BY patch DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({ patch: String(r['patch']), games: Number(r['games']) }));
}
