import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DDragonError } from './ddragon.ts';

/**
 * Champion portraits, item icons and the minimap, DOWNLOADED ONCE and served from here.
 *
 * The panel's header says "local, en tu máquina, nada de esto sale de acá", and hotlinking
 * Riot's CDN from the page would make that false on every load: the browser would announce what
 * he is looking at, and the panel would stop working on a bad connection. So the images are
 * fetched once by an explicit command and served by the local server like everything else.
 *
 * ICONS ARE COSMETIC AND COME FROM ONE VERSION, which is deliberate and different from how the
 * item TABLE is handled: classification is per patch (ADR-020) because a build path changes,
 * while the picture of Lich Bane is the same picture. Mixing those up is what would justify
 * eight copies of every icon; keeping them apart costs one folder.
 */

const BASE = 'https://ddragon.leagueoflegends.com';

/** Where a downloaded asset lives, relative to the assets root. */
export function assetPath(kind: 'champion' | 'item' | 'map', file: string): string {
  return `${kind}/${file}`;
}

/**
 * Rejects anything that is not a bare file name.
 *
 * The server hands this straight to the filesystem, so `..` or a slash here would be a path
 * traversal out of the cache directory. Checked at BOTH ends: nothing reaches disk without it.
 */
export function safeAssetName(name: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(name) && !name.includes('..');
}

async function download(url: string, dest: string): Promise<number> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new DDragonError(
      `no se pudo bajar ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw new DDragonError(`${url} devolvió ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  return bytes.length;
}

export type ChampionIndex = Map<string, string>;

/**
 * Champion id -> icon file name, straight from Data Dragon.
 *
 * A map rather than a guess: match-v5's `championName` is Data Dragon's `id` for almost every
 * champion and NOT for all of them, and a guessed file name fails as a broken image instead of
 * as an error. Whatever the index says is what gets downloaded.
 */
export async function fetchChampionIndex(version: string): Promise<ChampionIndex> {
  const response = await fetch(`${BASE}/cdn/${version}/data/es_MX/champion.json`);
  if (!response.ok)
    throw new DDragonError(`champion.json de ${version} devolvió ${response.status}`);
  const body = (await response.json()) as {
    data?: Record<string, { id?: string; image?: { full?: string } }>;
  };
  const data = body.data;
  if (data === undefined) throw new DDragonError(`champion.json de ${version} no trae 'data'`);
  const index: ChampionIndex = new Map();
  for (const [key, champion] of Object.entries(data)) {
    const file = champion.image?.full;
    if (file === undefined) continue;
    index.set(champion.id ?? key, file);
  }
  return index;
}

export type AssetReport = { downloaded: number; skipped: number; missing: string[]; bytes: number };

/** Downloads the icons for these champions, skipping the ones already on disk. */
export async function ensureChampionIcons(
  version: string,
  names: string[],
  index: ChampionIndex,
  root: string,
): Promise<AssetReport> {
  const report: AssetReport = { downloaded: 0, skipped: 0, missing: [], bytes: 0 };
  // Case-insensitive fallback: Riot's match data says `FiddleSticks` and Data Dragon says
  // `Fiddlesticks`. Same champion, different capital, and comparing them raw is the G-016 defect
  // in its cheapest form.
  const byLower = new Map([...index].map(([id, file]) => [id.toLowerCase(), file]));
  for (const name of names) {
    const file = index.get(name) ?? byLower.get(name.toLowerCase());
    if (file === undefined || !safeAssetName(file) || !safeAssetName(`${name}.png`)) {
      // Named rather than swallowed: a champion the index does not know is a fact worth seeing,
      // and the page falls back to text for it.
      report.missing.push(name);
      continue;
    }
    // Stored under the name the MATCH uses, not the one Data Dragon uses, so the page can build
    // the URL from what it already has and never needs the index at render time.
    const dest = join(root, 'champion', `${name}.png`);
    if (existsSync(dest)) {
      report.skipped += 1;
      continue;
    }
    report.bytes += await download(`${BASE}/cdn/${version}/img/champion/${file}`, dest);
    report.downloaded += 1;
  }
  return report;
}

/** Downloads the icons for these item ids, skipping the ones already on disk. */
export async function ensureItemIcons(
  version: string,
  ids: number[],
  root: string,
): Promise<AssetReport> {
  const report: AssetReport = { downloaded: 0, skipped: 0, missing: [], bytes: 0 };
  for (const id of ids) {
    const dest = join(root, 'item', `${id}.png`);
    if (existsSync(dest)) {
      report.skipped += 1;
      continue;
    }
    try {
      report.bytes += await download(`${BASE}/cdn/${version}/img/item/${id}.png`, dest);
      report.downloaded += 1;
    } catch {
      // An item with no art in this version is normal — removed items keep their id in old
      // games. It is recorded and the build row shows the name without a picture.
      report.missing.push(String(id));
    }
  }
  return report;
}

/** The Summoner's Rift minimap, which is the background the death map was missing. */
export async function ensureMap(version: string, root: string): Promise<AssetReport> {
  const dest = join(root, 'map', 'map11.png');
  if (existsSync(dest)) return { downloaded: 0, skipped: 1, missing: [], bytes: 0 };
  const bytes = await download(`${BASE}/cdn/${version}/img/map/map11.png`, dest);
  return { downloaded: 1, skipped: 0, missing: [], bytes };
}
