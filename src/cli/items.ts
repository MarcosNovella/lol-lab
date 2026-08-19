import { fetchItems, listVersions, versionForPatch } from '../riot/ddragon.ts';
import { openDb } from '../store/db.ts';
import { catalogVersions, patchesInCache, saveItems } from '../store/items.ts';
import { out } from './shared.ts';

/**
 * `lol items` — brings down the item table for every patch his cache actually contains.
 *
 * No key, no rate limiter, and idempotent: Data Dragon is immutable per version, so a second run
 * re-downloads nothing it already has unless asked. It is a separate command rather than a step
 * of the sync because it is a once-per-patch errand, and folding it into the nightly ritual would
 * spend a network round trip every evening to learn that nothing changed.
 */

export async function run(argv: string[]): Promise<void> {
  const force = argv.includes('--todo');
  const db = openDb();

  const patches = patchesInCache(db);
  if (patches.length === 0) {
    out('No hay partidas en caché todavía, así que no hay parche que buscar.');
    db.close();
    return;
  }

  const have = new Set(catalogVersions(db).map((c) => c.version));
  const versions = await listVersions();

  out(`Parches en caché: ${patches.map((p) => `${p.patch} (${p.games})`).join(' · ')}`);
  out('');

  let downloaded = 0;
  for (const { patch, games } of patches) {
    const version = versionForPatch(versions, patch);
    if (version === null) {
      // Never fall back to the newest catalogue: an item's build path changes between patches,
      // so the wrong table gives a confident wrong answer (G-015).
      out(
        `  ${patch}: Data Dragon no publica ese parche — esas ${games} partidas quedan sin ítems`,
      );
      continue;
    }
    if (have.has(version) && !force) {
      out(`  ${patch} → ${version}: ya está`);
      continue;
    }
    const items = await fetchItems(version);
    const saved = saveItems(db, items);
    downloaded += 1;
    out(
      `  ${patch} → ${version}: ${saved} ítems (${items.filter((i) => i.finished).length} terminados)`,
    );
  }

  out('');
  out(downloaded === 0 ? 'Nada nuevo que bajar.' : `Bajé ${downloaded} catálogo(s).`);
  db.close();
}

export const SUMMARY = 'baja la tabla de ítems de Data Dragon, un catálogo por parche jugado';
export const USAGE = 'lol items [--todo]';
