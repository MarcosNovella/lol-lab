import {
  type Briefing,
  buildBriefing,
  candidateFrom,
  type FocusCandidate,
  runway,
} from './analysis/briefing.ts';
import { untaggedGames } from './analysis/capture.ts';
import { coverageOf, coverageTotals } from './analysis/coverage.ts';
import { evaluationsOf, listHypotheses } from './analysis/hypotheses.ts';
import { collectMatchups } from './analysis/matchups.ts';
import { loadPriors, priorsKeyedLike } from './analysis/priors.ts';
import { describeRank, latestSnapshot, TRACKED_QUEUES } from './analysis/rank.ts';
import { keyState } from './riot/key.ts';
import { exposureOf, recordExposure } from './store/briefings.ts';
import type { Db } from './store/db.ts';
import { findAccount, lastSync, listAccounts } from './store/matches.ts';

/**
 * Arma el briefing previo a jugar y ANOTA lo que le mostró.
 *
 * Vive al lado de `sync.ts` y por la misma razón: es composición con I/O que necesitan tres
 * front-ends distintos (el CLI, el panel y el MCP), y bajarla a `analysis/` la ensuciaría —
 * `analysis/briefing.ts` decide QUÉ se puede mostrar y no toca la base. Subirla a cualquiera de
 * los tres la volvería propiedad de ese front-end, que es como se terminan escribiendo tres
 * versiones de la misma regla.
 */

export class PregameError extends Error {}

/** La única escritura de todo esto, y es el punto: mostrar sin anotar sería mentir después. */
export function assembleBriefing(db: Db, needle: string, now: number = Date.now()): Briefing {
  const record = findAccount(db, needle);
  if (record === null) {
    const known = listAccounts(db)
      .map((a) => a.label ?? a.gameName)
      .join(', ');
    throw new PregameError(
      known === ''
        ? `no hay ninguna cuenta '${needle}': la caché no tiene ninguna`
        : `no hay ninguna cuenta '${needle}'. Conocidas: ${known}`,
    );
  }

  const key = keyState(new Date(now));
  const cuentas = listAccounts(db).map((a) => ({
    pendientes: untaggedGames(db, a.puuid, { limit: 500 }).length,
    ultimoSyncAt: lastSync(db, a.puuid)?.startedAt ?? null,
  }));

  // `?? null` y NO `?? 0`: una fila que nunca se evaluó no acumuló cero, no se sabe cuánto
  // acumuló, y `pickFocus` necesita poder distinguirlas (G-029).
  const candidates: FocusCandidate[] = listHypotheses(db).map((h) =>
    candidateFrom(h, evaluationsOf(db, h.id)[0]?.n ?? null, exposureOf(db, h.id)?.first ?? null),
  );

  const label = record.label ?? record.gameName;
  const rows = collectMatchups(db);
  const priors = priorsKeyedLike(
    loadPriors(),
    rows.map((r) => ({ champion: r.champion, opponent: r.opponent })),
  );
  const totals = coverageTotals(rows, coverageOf(rows, { account: label, priors }));

  const briefing = buildBriefing({
    at: now,
    account: label,
    // Todas las cuentas, no solo la que va a jugar: una partida sin taguear en la otra es
    // igual de irrecuperable, y la key es una sola para las dos.
    runway: runway({
      cuentas,
      key: {
        presente: key.present,
        probablementeVencida: key.likelyExpired,
        problema: key.problem,
      },
      now,
    }),
    candidates,
    clock: TRACKED_QUEUES.map((cola) => {
      const snapshot = latestSnapshot(db, record.puuid, cola);
      return {
        queue: cola,
        text: describeRank(snapshot),
        wins: snapshot?.wins ?? null,
        losses: snapshot?.losses ?? null,
      };
    }),
    silence: { muted: totals.silent, total: totals.matchups },
  });

  // La contaminación empieza cuando lo LEE, no cuando lo usa, así que se anota al mostrarlo.
  // Que abrir el panel después de jugar también anote es el error en la dirección correcta:
  // sobrestimar la exposición nunca deja pasar un veredicto sucio como si fuera limpio.
  if (briefing.focus !== null) {
    recordExposure(db, { hypothesisId: briefing.focus.id, puuid: record.puuid }, now);
  }
  return briefing;
}
