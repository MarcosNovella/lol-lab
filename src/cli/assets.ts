import { ASSETS_ROOT, openDb } from '../store/db.ts';
import { bajarImagenes } from '../upkeep.ts';
import { out } from './shared.ts';

/**
 * `lol assets` — baja las imágenes una vez: retratos, íconos de ítem y el minimapa.
 *
 * Distinto de `lol items` porque contestan cosas distintas: aquel cachea la TABLA de ítems por
 * parche, que decide qué cuenta como ítem terminado; esto cachea ARTE, que es el mismo dibujo en
 * todos los parches y existe solo para que el panel se entienda de un vistazo.
 *
 * La lógica vive en `src/upkeep.ts`, que es lo que corre el botón del panel: una sola
 * implementación de "qué imagen falta".
 */

export async function run(): Promise<void> {
  const db = openDb();
  try {
    out(`Destino: ${ASSETS_ROOT}`);
    out('');
    const result = await bajarImagenes(db, (_hechas, _total, detalle) => out(`  ${detalle}…`));

    if (result.bloqueado !== null) {
      out('');
      out(`No se puede todavía: ${result.bloqueado}.`);
      out('Corré `lol items` primero, o apretá el botón en el panel.');
      return;
    }

    out('');
    out(`${result.bajadas} bajadas · ${result.yaEstaban} ya estaban · ${result.sinArte} sin arte`);
    out(
      result.bajadas === 0 ? 'Nada nuevo.' : `${result.megas.toFixed(1)} MB bajados una sola vez.`,
    );
  } finally {
    db.close();
  }
}

export const SUMMARY =
  'baja los íconos de campeones e ítems y el minimapa, para que el panel se lea';
export const USAGE = 'lol assets';
