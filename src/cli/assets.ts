import { join } from 'node:path';
import {
  ensureChampionIcons,
  ensureItemIcons,
  ensureMap,
  fetchChampionIndex,
} from '../riot/assets.ts';
import { listVersions } from '../riot/ddragon.ts';
import { ASSETS_ROOT, openDb } from '../store/db.ts';
import { catalogVersions } from '../store/items.ts';
import { out } from './shared.ts';

/**
 * `lol assets` — brings down the pictures once: every champion he or his opponents have played,
 * the item icons, and the Rift minimap.
 *
 * Separate from `lol items` because they answer different questions. That one caches the item
 * TABLE per patch, which decides what counts as a finished item; this one caches ART, which is
 * the same picture in every patch and exists only so the panel is readable at a glance.
 *
 * Idempotent by file existence: a second run downloads nothing and says so.
 */

export async function run(argv: string[]): Promise<void> {
  const db = openDb();
  const root = ASSETS_ROOT;

  const champions = (
    db.prepare('SELECT DISTINCT champion FROM participants ORDER BY champion').all() as Record<
      string,
      unknown
    >[]
  ).map((r) => String(r['champion']));

  // Item ART comes from the newest cached catalogue: the icon does not change with the patch,
  // and eight copies of the same PNG would be eight times the disk for nothing.
  const newest = catalogVersions(db)[0]?.version;
  if (newest === undefined) {
    out('No hay catálogo de ítems todavía — corré `lol items` primero.');
    db.close();
    return;
  }
  const itemIds = (
    db
      .prepare('SELECT item_id FROM items WHERE version = ? ORDER BY item_id')
      .all(newest) as Record<string, unknown>[]
  ).map((r) => Number(r['item_id']));

  const version = argv[0] ?? (await listVersions())[0];
  if (version === undefined) throw new Error('Data Dragon no devolvió ninguna versión');

  out(`Versión de arte: ${version}  ·  destino: ${join(root)}`);
  out('');

  const index = await fetchChampionIndex(version);
  const champs = await ensureChampionIcons(version, champions, index, root);
  out(
    `campeones  ${champs.downloaded} bajados · ${champs.skipped} ya estaban` +
      (champs.missing.length > 0 ? ` · sin ícono: ${champs.missing.join(', ')}` : ''),
  );

  const items = await ensureItemIcons(version, itemIds, root);
  out(
    `ítems      ${items.downloaded} bajados · ${items.skipped} ya estaban` +
      (items.missing.length > 0 ? ` · ${items.missing.length} sin arte en esta versión` : ''),
  );

  const map = await ensureMap(version, root);
  out(`mapa       ${map.downloaded === 1 ? 'bajado' : 'ya estaba'}`);

  const total = champs.bytes + items.bytes + map.bytes;
  out('');
  out(total === 0 ? 'Nada nuevo.' : `${(total / 1024 / 1024).toFixed(1)} MB bajados una sola vez.`);
  db.close();
}

export const SUMMARY =
  'baja los íconos de campeones e ítems y el minimapa, para que el panel se lea';
export const USAGE = 'lol assets [versión]';
