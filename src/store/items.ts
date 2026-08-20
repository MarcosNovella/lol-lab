import { championKey } from '../analysis/names.ts';
import type { ChampionRecord, ItemRecord, RuneRecord } from '../riot/ddragon.ts';
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

// ------------------------------------------------------------------ runas y clases

export type RuneCatalog = Map<
  number,
  { key: string; name: string; treeId: number; treeName: string; slot: number; icon: string }
>;

export function saveRunes(db: Db, runes: RuneRecord[]): number {
  return transaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO runes (rune_id, version, key, name, tree_id, tree_key, tree_name, slot, icon)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (rune_id, version) DO UPDATE SET
         key = excluded.key, name = excluded.name, tree_id = excluded.tree_id,
         tree_key = excluded.tree_key, tree_name = excluded.tree_name,
         slot = excluded.slot, icon = excluded.icon`,
    );
    for (const r of runes) {
      insert.run(
        r.runeId,
        r.version,
        r.key,
        r.name,
        r.treeId,
        r.treeKey,
        r.treeName,
        r.slot,
        r.icon,
      );
    }
    return runes.length;
  });
}

export function saveChampions(db: Db, champions: ChampionRecord[]): number {
  return transaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO champions (champion_id, version, key, name, title, tags)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (champion_id, version) DO UPDATE SET
         key = excluded.key, name = excluded.name, title = excluded.title, tags = excluded.tags`,
    );
    for (const c of champions) {
      insert.run(c.championId, c.version, c.key, c.name, c.title, c.tags);
    }
    return champions.length;
  });
}

/** The rune table for a MATCH patch, found among the versions actually cached. Null when the
 *  patch was never fetched — never another patch's trees, which move every preseason. */
export function runesForPatch(db: Db, patch: string): RuneCatalog | null {
  const version = versionParaParche(db, 'runes', patch);
  if (version === null) return null;
  const rows = db
    .prepare(
      'SELECT rune_id, key, name, tree_id, tree_name, slot, icon FROM runes WHERE version = ?',
    )
    .all(version) as Record<string, unknown>[];
  const catalog: RuneCatalog = new Map();
  for (const row of rows) {
    catalog.set(Number(row['rune_id']), {
      key: String(row['key']),
      name: String(row['name']),
      treeId: Number(row['tree_id']),
      treeName: String(row['tree_name']),
      slot: Number(row['slot']),
      icon: String(row['icon']),
    });
  }
  return catalog.size === 0 ? null : catalog;
}

/**
 * Champion classes, keyed by `championKey` — never by a raw spelling.
 *
 * Look one up with `clasesDe`, which normalises the same way. Reading it with a raw
 * `catalog.get(championName)` is the G-016 bug and it will silently return undefined for
 * exactly the champions whose two spellings differ.
 */
export type ChampionCatalog = Map<string, { name: string; title: string; tags: string[] }>;

/**
 * Champion classes, keyed by Riot's PascalCase id — the spelling a match payload carries.
 *
 * Unlike items and runes, this one falls back to the NEWEST cached version when the exact patch
 * is missing, and the difference is deliberate: an item's build path and a rune's tree change
 * between patches in ways that would relabel a game, but a champion's class is an identity, not
 * a balance number. Refusing to say Zed is an assassin because the 15.6 catalogue is missing
 * would be precision theatre.
 */
export function championsForPatch(db: Db, patch: string): ChampionCatalog | null {
  const version =
    versionParaParche(db, 'champions', patch) ??
    ((
      db.prepare('SELECT version FROM champions ORDER BY version DESC LIMIT 1').get() as
        | Record<string, unknown>
        | undefined
    )?.['version'] as string | undefined) ??
    null;
  if (version === null) return null;
  const rows = db
    .prepare('SELECT key, name, title, tags FROM champions WHERE version = ?')
    .all(version) as Record<string, unknown>[];
  // Keyed through `championKey`, NOT by the raw id (G-016). Riot's match payload says
  // `LeBlanc` and Data Dragon says `Leblanc` — one capital apart — so a raw `Map.get` returned
  // undefined for her and she came back unclassified. `FiddleSticks`/`Fiddlesticks` is the same
  // defect and `ensureChampionIcons` already carried a fallback for it; this is the third place
  // the spelling has bitten, so it goes through the normaliser like everything else.
  const catalog: ChampionCatalog = new Map();
  for (const row of rows) {
    catalog.set(championKey(String(row['key'])), {
      name: String(row['name']),
      title: String(row['title']),
      tags: String(row['tags'])
        .split(',')
        .filter((t) => t !== ''),
    });
  }
  return catalog.size === 0 ? null : catalog;
}

/**
 * The newest cached version whose `major.minor` matches a match patch.
 *
 * Data Dragon publishes `16.14.1` for match patch `16.14`, and occasionally a `.2`. Ordered by
 * the REVISION as a number rather than by the string, because '16.14.9' sorts above '16.14.10'
 * as text — rare, and the kind of rare that produces one wrong answer nobody investigates.
 */
function versionParaParche(db: Db, tabla: 'runes' | 'champions', patch: string): string | null {
  const rows = db
    .prepare(`SELECT DISTINCT version FROM ${tabla} WHERE version LIKE ? || '.%'`)
    .all(patch) as Record<string, unknown>[];
  const versions = rows.map((r) => String(r['version']));
  if (versions.length === 0) return null;
  const revision = (v: string): number => Number(v.slice(patch.length + 1).split('.')[0] ?? 0);
  return versions.sort((a, b) => revision(b) - revision(a))[0] ?? null;
}

/** Which catalogue versions are cached, per kind, so a command can say what is missing. */
export function catalogosCacheados(db: Db): {
  items: string[];
  runes: string[];
  champions: string[];
} {
  const versiones = (tabla: string): string[] =>
    (
      db.prepare(`SELECT DISTINCT version FROM ${tabla} ORDER BY version DESC`).all() as Record<
        string,
        unknown
      >[]
    ).map((r) => String(r['version']));
  return {
    items: versiones('items'),
    runes: versiones('runes'),
    champions: versiones('champions'),
  };
}
