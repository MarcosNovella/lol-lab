/**
 * Data Dragon: Riot's static game data, which is a different thing from the Riot API.
 *
 * It exists here to answer one question the match timeline cannot: `ITEM_PURCHASED` carries an
 * `itemId` and nothing else, so without a table of items there is no way to tell a Long Sword
 * from a finished mythic, and "when does he complete his first item" was CUT from M2 for exactly
 * that reason (state.md, 2026-08-16).
 *
 * Three properties make this cheap where the match API is expensive, and they are why this file
 * does NOT reuse `client.ts`:
 * - it needs NO API KEY, so nothing here can be broken by the 24-hour rotation;
 * - it is a CDN on a different host, so it must NOT pass through the Riot rate limiter — every
 *   request spent here would be a match not downloaded;
 * - it is versioned and immutable per version, so one fetch per patch is one fetch forever.
 *
 * PER PATCH, not "latest". His cache spans 16.6 to 16.16, and an item's build path changes
 * between patches: reading a 16.6 game against the 16.16 table would silently reclassify items
 * that were finished then and are components now. Every catalogue is stored under the version it
 * came from, and a game whose patch has no catalogue is REPORTED as such rather than analysed
 * with the wrong one (G-015).
 */

const BASE = 'https://ddragon.leagueoflegends.com';

export class DDragonError extends Error {}

export type ItemRecord = {
  itemId: number;
  name: string;
  goldTotal: number;
  /** Nothing in this patch builds out of it — the definition of "finished" comes from the data. */
  finished: boolean;
  /** Data Dragon's own tags, comma-joined, kept so a later question can re-slice without a refetch. */
  tags: string;
  version: string;
};

export type ItemJson = {
  name?: string;
  gold?: { total?: number; purchasable?: boolean };
  tags?: string[];
  into?: string[];
  maps?: Record<string, boolean>;
  inStore?: boolean;
};

async function getJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`);
  } catch (error) {
    throw new DDragonError(
      `no se pudo hablar con Data Dragon (${path}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new DDragonError(`Data Dragon devolvió ${response.status} en ${path}`);
  }
  return response.json();
}

/** Every published version, newest first. */
export async function listVersions(): Promise<string[]> {
  const body = await getJson('/api/versions.json');
  if (!Array.isArray(body)) throw new DDragonError('versions.json no es una lista');
  return body.map(String);
}

/**
 * The Data Dragon version for a match patch like `16.14`.
 *
 * Riot's match `gameVersion` is `16.14.794.9266` and Data Dragon's is `16.14.1`: the same patch,
 * different shapes. Matching on the `major.minor` prefix is the only join that exists, and a
 * patch with no published catalogue returns null instead of the nearest one.
 */
export function versionForPatch(versions: string[], patch: string): string | null {
  return versions.find((v) => v.startsWith(`${patch}.`)) ?? null;
}

/**
 * The item table for one version.
 *
 * `finished` is derived, not listed: an item nothing builds out of is a finished item in that
 * patch, whatever the patch decided. Consumables, trinkets and anything not purchasable on
 * Summoner's Rift are dropped — a Control Ward has no `into` either and is not a build step.
 */
export function itemsFromJson(version: string, data: Record<string, ItemJson>): ItemRecord[] {
  const out: ItemRecord[] = [];
  for (const [id, item] of Object.entries(data)) {
    const itemId = Number(id);
    if (!Number.isInteger(itemId)) continue;
    const tags = item.tags ?? [];
    const goldTotal = item.gold?.total ?? 0;
    const onRift = item.maps?.['11'] !== false;
    const buyable = item.gold?.purchasable !== false && item.inStore !== false;
    if (!onRift || !buyable || goldTotal <= 0) continue;
    if (tags.includes('Consumable') || tags.includes('Trinket')) continue;

    out.push({
      itemId,
      name: item.name ?? `item ${itemId}`,
      goldTotal,
      finished: (item.into ?? []).length === 0,
      tags: tags.join(','),
      version,
    });
  }
  return out;
}

export async function fetchItems(version: string): Promise<ItemRecord[]> {
  const body = await getJson(`/cdn/${version}/data/es_MX/item.json`);
  const data = (body as { data?: Record<string, ItemJson> }).data;
  if (data === undefined) throw new DDragonError(`item.json de ${version} no trae 'data'`);

  const out = itemsFromJson(version, data);
  if (out.length === 0) throw new DDragonError(`item.json de ${version} quedó vacío tras filtrar`);
  return out;
}

/**
 * A rune, flattened out of Data Dragon's tree-of-slots-of-runes shape.
 *
 * `slot` is what makes a KEYSTONE identifiable without a second table: slot 0 of a tree holds
 * its keystones and nothing else, so `slot === 0` is the definition rather than a hardcoded list
 * of ids that goes stale every preseason.
 */
export type RuneRecord = {
  runeId: number;
  /** Riot's internal name, e.g. `Electrocute`. Stable across locales, unlike `name`. */
  key: string;
  name: string;
  treeId: number;
  treeKey: string;
  treeName: string;
  slot: number;
  /** Path under the CDN, e.g. `perk-images/Styles/Domination/Electrocute/Electrocute.png`. */
  icon: string;
  version: string;
};

export type RuneTreeJson = {
  id?: number;
  key?: string;
  name?: string;
  slots?: { runes?: { id?: number; key?: string; name?: string; icon?: string }[] }[];
};

export function runesFromJson(version: string, data: RuneTreeJson[]): RuneRecord[] {
  const out: RuneRecord[] = [];
  for (const tree of data) {
    if (tree.id === undefined) continue;
    for (const [slot, bucket] of (tree.slots ?? []).entries()) {
      for (const rune of bucket.runes ?? []) {
        if (rune.id === undefined) continue;
        out.push({
          runeId: rune.id,
          key: rune.key ?? String(rune.id),
          name: rune.name ?? String(rune.id),
          treeId: tree.id,
          treeKey: tree.key ?? String(tree.id),
          treeName: tree.name ?? String(tree.id),
          slot,
          icon: rune.icon ?? '',
          version,
        });
      }
    }
  }
  return out;
}

export async function fetchRunes(version: string): Promise<RuneRecord[]> {
  const body = await getJson(`/cdn/${version}/data/es_MX/runesReforged.json`);
  if (!Array.isArray(body)) throw new DDragonError(`runesReforged de ${version} no es una lista`);
  const out = runesFromJson(version, body as RuneTreeJson[]);
  if (out.length === 0) throw new DDragonError(`runesReforged de ${version} quedó vacío`);
  return out;
}

/**
 * A champion's identity card: the CLASSES Riot assigns it, and nothing derived.
 *
 * The classes are the point. Every comparison in this project is against the specific opponent
 * he happened to face, which is correct and gives an n of one per game; the class is the only
 * grouping of opponents that exists before the game starts and is therefore usable as a
 * stratum without inheriting the result (G-008). "How do I do into assassins" is a question his
 * own cache can answer once the labels exist, and they only exist here.
 *
 * `key` is Riot's PascalCase id (`TwistedFate`), which is what a match payload carries, so the
 * join needs no name normalisation — but consumers still go through `championKey` (G-016),
 * because op.gg and the vault spell it two other ways.
 */
export type ChampionRecord = {
  championId: number;
  key: string;
  name: string;
  title: string;
  /** Comma-joined Riot classes: Assassin, Fighter, Mage, Marksman, Support, Tank. */
  tags: string;
  version: string;
};

export type ChampionJson = {
  key?: string;
  id?: string;
  name?: string;
  title?: string;
  tags?: string[];
};

export function championsFromJson(
  version: string,
  data: Record<string, ChampionJson>,
): ChampionRecord[] {
  const out: ChampionRecord[] = [];
  for (const champion of Object.values(data)) {
    const championId = Number(champion.key);
    if (!Number.isInteger(championId) || champion.id === undefined) continue;
    out.push({
      championId,
      key: champion.id,
      name: champion.name ?? champion.id,
      title: champion.title ?? '',
      tags: (champion.tags ?? []).join(','),
      version,
    });
  }
  return out;
}

export async function fetchChampions(version: string): Promise<ChampionRecord[]> {
  const body = await getJson(`/cdn/${version}/data/es_MX/champion.json`);
  const data = (body as { data?: Record<string, ChampionJson> }).data;
  if (data === undefined) throw new DDragonError(`champion.json de ${version} no trae 'data'`);
  const out = championsFromJson(version, data);
  if (out.length === 0) throw new DDragonError(`champion.json de ${version} quedó vacío`);
  return out;
}
