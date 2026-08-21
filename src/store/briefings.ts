import type { Db } from './db.ts';

/**
 * El registro de qué hipótesis se le mostró antes de jugar, y desde cuándo.
 *
 * La razón entera está en `analysis/briefing.ts`: mostrar una fila viva del ledger antes de una
 * partida la contamina a propósito, y lo que no puede pasar es que después nadie sepa desde qué
 * fecha. Con esto una evaluación posterior puede decir "jugaste 12 partidas después de que te la
 * mostrara" en vez de arrastrar la advertencia como prosa.
 */

/**
 * Dos exposiciones separadas por menos de esto son la misma sentada.
 *
 * El panel se abre varias veces por noche y el CLI se puede correr dos veces seguidas; sin esto
 * el conteo mediría cuántas veces refrescó la página, que no es lo que la columna dice. Con esto
 * una fila del conteo es una sentada en la que la vio.
 */
export const SESSION_GAP_MS = 6 * 3_600_000;

export type Exposure = { first: number; last: number; count: number };

/**
 * Anota que se le mostró. Devuelve `true` si escribió, `false` si es la misma sentada.
 *
 * No hay forma de mirar el briefing SIN anotar, y es deliberado: una opción de "mostrámelo pero
 * no lo cuentes" convierte el registro en una fuente que miente, y el registro existe justamente
 * para el momento en que el veredicto haya que creerlo o no.
 */
export function recordExposure(
  db: Db,
  input: { hypothesisId: string; puuid: string },
  now: number = Date.now(),
): boolean {
  const previa = db
    .prepare(
      `SELECT MAX(shown_at) AS last FROM briefing_exposures
        WHERE hypothesis_id = ? AND puuid = ?`,
    )
    .get(input.hypothesisId, input.puuid) as Record<string, unknown> | undefined;
  const last = previa?.['last'];
  if (last !== null && last !== undefined && now - Number(last) < SESSION_GAP_MS) return false;

  db.prepare(
    'INSERT INTO briefing_exposures (hypothesis_id, puuid, shown_at) VALUES (?, ?, ?)',
  ).run(input.hypothesisId, input.puuid, now);
  return true;
}

/** Cuándo se mostró por primera y última vez, y cuántas sentadas. `null` si nunca. */
export function exposureOf(db: Db, hypothesisId: string): Exposure | null {
  const row = db
    .prepare(
      `SELECT MIN(shown_at) AS first, MAX(shown_at) AS last, COUNT(*) AS n
         FROM briefing_exposures WHERE hypothesis_id = ?`,
    )
    .get(hypothesisId) as Record<string, unknown> | undefined;
  const first = row?.['first'];
  if (row === undefined || first === null || first === undefined) return null;
  return { first: Number(first), last: Number(row['last']), count: Number(row['n']) };
}

/**
 * Partidas REALES que esta cuenta jugó desde un instante — lo que la exposición pudo haber
 * tocado.
 *
 * Mismo filtro de remake que usa el resto del proyecto (duración >= 300s y una posición de
 * verdad): una partida de 68 segundos no tiene comportamiento que contaminar.
 *
 * Se cuenta sobre `game_creation` y no sobre el fin: lo que importa es si ya lo sabía cuando
 * entró a esa partida.
 */
export function gamesSince(db: Db, puuid: string, since: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM participants p
         JOIN matches m ON m.match_id = p.match_id
        WHERE p.puuid = ?
          AND m.game_creation >= ?
          AND m.game_duration >= 300
          AND p.team_position <> ''`,
    )
    .get(puuid, since) as Record<string, unknown>;
  return Number(row['n']);
}
