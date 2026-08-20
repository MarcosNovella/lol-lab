import {
  fetchChampions,
  fetchItems,
  fetchRunes,
  listVersions,
  versionForPatch,
} from '../riot/ddragon.ts';
import { openDb } from '../store/db.ts';
import {
  catalogosCacheados,
  patchesInCache,
  saveChampions,
  saveItems,
  saveRunes,
} from '../store/items.ts';
import { out } from './shared.ts';

/**
 * `lol catalogos` — the static tables for every patch his cache actually contains.
 *
 * THREE of them now, and the second and third cost nothing new: `items` (build timings, ADR-020),
 * `runes` (which keystone he and his opponent ran) and `champions` (the classes, so "how do I do
 * into assassins" becomes answerable). All three come from the same host, all three are
 * immutable per version, and none of them spends a Riot request or touches the rate limiter — so
 * adding two more catalogues to this errand costs one round trip per patch and no budget at all.
 *
 * Runes are the interesting one: the perks have been in every cached match since the first sync
 * and nothing read them, because there was no table saying what a perk id meant. That is ADR-004
 * working exactly as written — the raw payload was kept so a dimension nobody thought to flatten
 * could be derived later without re-downloading anything.
 *
 * Idempotent: a second run re-downloads nothing it already has unless asked with `--todo`. It is
 * a separate command rather than a step of the sync because it is a once-per-patch errand, and
 * folding it into the nightly ritual would spend three round trips every evening to learn that
 * nothing changed.
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

  const cacheados = catalogosCacheados(db);
  const have = {
    items: new Set(cacheados.items),
    runes: new Set(cacheados.runes),
    champions: new Set(cacheados.champions),
  };
  const versions = await listVersions();

  out(`Parches en caché: ${patches.map((p) => `${p.patch} (${p.games})`).join(' · ')}`);
  out('');

  let downloaded = 0;
  for (const { patch, games } of patches) {
    const version = versionForPatch(versions, patch);
    if (version === null) {
      // Never fall back to the newest catalogue: an item's build path and a rune's tree both
      // change between patches, so the wrong table gives a confident wrong answer (G-015).
      out(
        `  ${patch}: Data Dragon no publica ese parche — esas ${games} partidas quedan sin tablas`,
      );
      continue;
    }

    const partes: string[] = [];
    if (have.items.has(version) && !force) {
      partes.push('ítems ya estaban');
    } else {
      const items = await fetchItems(version);
      partes.push(
        `${saveItems(db, items)} ítems (${items.filter((i) => i.finished).length} terminados)`,
      );
      downloaded += 1;
    }
    if (have.runes.has(version) && !force) {
      partes.push('runas ya estaban');
    } else {
      const runes = await fetchRunes(version);
      partes.push(
        `${saveRunes(db, runes)} runas (${runes.filter((r) => r.slot === 0).length} keystones)`,
      );
      downloaded += 1;
    }
    if (have.champions.has(version) && !force) {
      partes.push('campeones ya estaban');
    } else {
      const champions = await fetchChampions(version);
      partes.push(`${saveChampions(db, champions)} campeones`);
      downloaded += 1;
    }
    out(`  ${patch} → ${version}: ${partes.join(' · ')}`);
  }

  out('');
  out(downloaded === 0 ? 'Nada nuevo que bajar.' : `Bajé ${downloaded} tabla(s).`);
  out('Las runas salen de partidas que ya tenías: no gastó ni un request de Riot.');
  db.close();
}

export const SUMMARY =
  'baja las tablas de Data Dragon (ítems, runas, clases), una por parche jugado';
export const USAGE = 'lol catalogos [--todo]';
