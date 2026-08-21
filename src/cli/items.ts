import { openDb } from '../store/db.ts';
import { catalogVersions, patchesInCache } from '../store/items.ts';
import { bajarCatalogos } from '../upkeep.ts';
import { out } from './shared.ts';

/**
 * `lol items` — baja la tabla de ítems de cada parche que la caché contenga.
 *
 * Sin key, sin rate limiter, e idempotente: Data Dragon es inmutable por versión, así que una
 * segunda corrida no vuelve a bajar nada.
 *
 * La lógica vive en `src/upkeep.ts` y no acá: el panel corre exactamente esto detrás del botón de
 * sincronizar, y dos implementaciones de "qué catálogo falta" es cómo terminan dando respuestas
 * distintas el día que una aprende algo que la otra no.
 */

export async function run(): Promise<void> {
  const db = openDb();
  try {
    const patches = patchesInCache(db);
    if (patches.length === 0) {
      out('No hay partidas en caché todavía, así que no hay parche que buscar.');
      return;
    }
    out(`Parches en caché: ${patches.map((p) => `${p.patch} (${p.games})`).join(' · ')}`);
    out('');

    const result = await bajarCatalogos(db, (hechas, total, detalle) =>
      out(`  ${detalle} (${hechas}/${total})`),
    );

    for (const patch of result.sinPublicar) {
      // Nunca caer al catálogo más nuevo: el build path de un ítem cambia entre parches (G-015).
      out(`  ${patch}: Data Dragon no publica ese parche — esas partidas quedan sin ítems`);
    }
    out('');
    out(
      result.bajados === 0
        ? `Nada nuevo que bajar (${result.yaEstaban} ya estaban).`
        : `Bajé ${result.bajados} catálogo(s). Ahora hay ${catalogVersions(db).length}.`,
    );
  } finally {
    db.close();
  }
}

export const SUMMARY = 'baja la tabla de ítems de Data Dragon, un catálogo por parche jugado';
export const USAGE = 'lol items';
