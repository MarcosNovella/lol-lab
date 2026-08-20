import {
  closeSession,
  openSession,
  TAG_KEYS,
  type Tag,
  tagGame,
  untaggedGames,
} from '../analysis/capture.ts';
import { coverageFor } from '../analysis/coverage.ts';
import {
  type Evaluation,
  evaluateHypothesis,
  listHypotheses,
  verdictLabel,
} from '../analysis/hypotheses.ts';
import { collectMatchups } from '../analysis/matchups.ts';
import { standardMeasure } from '../analysis/measures.ts';
import { expensiveMoments } from '../analysis/moments.ts';
import { loadPriors, priorsKeyedLike } from '../analysis/priors.ts';
import { createClient } from '../riot/client.ts';
import type { Db } from '../store/db.ts';
import { openDb } from '../store/db.ts';
import { getRawMatch, getRawTimeline, listAccounts, queryParticipants } from '../store/matches.ts';
import { snapshotAll } from './rank.ts';
import { account, CliError, labelOf, localStamp, out, readKey } from './shared.ts';

/**
 * `lol cerrar` — the one ritual.
 *
 * ADR-007 bought about thirty seconds a session: one tap per game plus a tilt at the end. This
 * is where that is spent, and everything else the command prints is the return on it.
 *
 * The order is deliberate. CAPTURE COMES FIRST and each tag is committed the moment it is
 * typed, before a single number is computed. Everything after it — the expensive moments, the
 * ledger, the coverage — can fail, and none of it can cost the input, which is the only thing
 * in this project that cannot be recomputed tomorrow.
 *
 * There is no separate weekly review. Marcos asked for the post-session moment and only that
 * one, so the review's CONTENT lives in step 4 and appears when it has something to say instead
 * of on a calendar. A ritual that reports "nothing changed" every night stops being read.
 */

export async function run(argv: string[]): Promise<void> {
  const db = openDb();
  try {
    const record = argv[0] === undefined ? mostRecentlyPlayed(db) : account(db, argv[0]);
    const label = labelOf(record);
    out(`Cierre de sesión — ${label}`);
    out();

    const before = new Set(queryParticipants(db, { puuid: record.puuid }).map((r) => r.matchId));

    // 1. Bring the cache up to date. Failure here is survivable and must not end the ritual:
    //    the development key expires every 24h, and losing tonight's tags to an expired key
    //    would be losing the irreplaceable half to the replaceable one.
    await sync(db, record.puuid);
    await snapshotRank(db);

    // 2. Capture. Everything below this point is optional; this is not.
    const pending = untaggedGames(db, record.puuid, { limit: 20 });
    const sessionId = pending.length > 0 ? openSession(db, record.puuid) : null;
    const tagged = new Map<string, Tag>();

    if (pending.length === 0) {
      out('Nada sin taguear. ');
    } else {
      out(`${pending.length} partida(s) sin taguear. Por cada una:`);
      out('  y = la perdí/gané yo    i = salía igual    p = estuvo pareja');
      out();
      // Oldest first: he replays the session in the order he lived it, which is how he
      // remembers it. `untaggedGames` returns newest first for every other consumer.
      for (const game of [...pending].reverse()) {
        const result = game.win ? 'victoria' : 'DERROTA';
        process.stdout.write(
          `  ${localStamp(game.endedAt)}  ${game.champion.padEnd(12)} ${result.padEnd(8)} > `,
        );
        const key = await readKey(Object.keys(TAG_KEYS));
        const tag = TAG_KEYS[key];
        if (tag === undefined) throw new CliError(`unmapped key '${key}'`);
        // Committed here, one game at a time. Not batched at the end of the loop.
        tagGame(db, { matchId: game.matchId, puuid: record.puuid, tag, sessionId });
        tagged.set(game.matchId, tag);
      }

      out();
      process.stdout.write('  Tilt de la sesión (1 tranquilo … 5 fundido, 0 = no contesto) > ');
      const tiltKey = await readKey(['0', '1', '2', '3', '4', '5']);
      const tilt = tiltKey === '0' ? null : Number(tiltKey);
      if (sessionId !== null) closeSession(db, sessionId, tilt);
      out();
    }

    // 3. What those games cost. Only the games that are new to this run — re-printing the same
    //    three moments every night is how a report stops being read.
    const fresh = queryParticipants(db, { puuid: record.puuid, limit: 20 }).filter(
      (r) => !before.has(r.matchId) || tagged.has(r.matchId),
    );
    reportMoments(db, record.puuid, fresh, tagged);

    // 4. What changed. Silent when nothing did.
    changes(db, record.puuid, label, fresh);
  } finally {
    db.close();
  }
}

function mostRecentlyPlayed(db: Db): ReturnType<typeof account> {
  const accounts = listAccounts(db);
  if (accounts.length === 0) throw new CliError('the cache has no accounts yet');
  let best: { record: (typeof accounts)[number]; at: number } | null = null;
  for (const candidate of accounts) {
    const last = queryParticipants(db, { puuid: candidate.puuid, limit: 1 })[0];
    const at = last?.gameCreation ?? 0;
    if (best === null || at > best.at) best = { record: candidate, at };
  }
  if (best === null) throw new CliError('the cache has no accounts yet');
  return best.record;
}

async function sync(db: Db, puuid: string): Promise<void> {
  const { syncMatches } = await import('../sync.ts');
  try {
    const client = createClient();
    const result = await syncMatches(client, db, {
      puuid,
      max: 20,
      // Without timelines there are no expensive moments, which is most of what this prints.
      withTimeline: true,
    });
    out(
      `  sync: ${result.fetched} nueva(s), ${result.skipped} ya estaban, ` +
        `${result.timelines} timeline(s), ${result.remakes} remake(s)`,
    );
    for (const error of result.errors.slice(0, 3)) out(`  sync: ${error}`);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    out(`  sync: NO corrió (${why})`);
    out('  Sigo igual con lo que hay en caché — los tags no dependen de la API.');
  }
}

async function snapshotRank(db: Db): Promise<void> {
  // Only the rows that actually changed are worth a line here — `snapshotAll` deduplicates on
  // value, so on an evening nothing moved this prints nothing at all.
  const report = await snapshotAll(db);
  for (const line of report.lines.filter((l) => l.includes('registrado'))) out(`  rango: ${line}`);
}

function reportMoments(
  db: Db,
  puuid: string,
  rows: ReturnType<typeof queryParticipants>,
  tagged: Map<string, Tag>,
): void {
  if (rows.length === 0) return;
  out('Lo que salió caro:');
  for (const row of rows) {
    const match = getRawMatch(db, row.matchId);
    const timeline = getRawTimeline(db, row.matchId);
    const tag = tagged.get(row.matchId);
    const head =
      `  ${localStamp(row.gameCreation)}  ${row.champion.padEnd(12)}` +
      `${row.win === 1 ? 'victoria' : 'DERROTA'}${tag === undefined ? '' : `  [${tag}]`}`;
    out(head);
    if (match === null || timeline === null) {
      out('     sin timeline en caché — nada que derivar');
      continue;
    }
    const { moments, unmeasurable } = expensiveMoments(match, timeline, puuid, 3);
    if (moments.length === 0) out('     sin momentos medibles');
    for (const moment of moments) {
      out(`     min ${moment.at.padStart(5)}  ${moment.line}  [${moment.costGold} de oro]`);
    }
    if (unmeasurable > 0) {
      out(`     (${unmeasurable} muertes sin ventana de 2 min por delante, no rankeadas)`);
    }
  }
  out();
  out('  Los replays .rofl se rompen al cambiar de parche: esto sirve dentro de la semana.');
  out();
}

/**
 * The review, folded into the ritual.
 *
 * Two questions, both answered only when the answer is not "nothing": did any registered
 * hypothesis change its verdict, and does he now have enough games in the matchups he just
 * played for the engine to say anything about them.
 */
function changes(
  db: Db,
  puuid: string,
  label: string,
  rows: ReturnType<typeof queryParticipants>,
): void {
  const lines: string[] = [];

  const live = listHypotheses(db);
  if (live.length > 0) {
    const measure = standardMeasure(db);
    for (const h of live) {
      let evaluation: Evaluation;
      try {
        // The spec is handed back explicitly so a drifted call site fails loudly (G-013).
        evaluation = evaluateHypothesis(db, h.id, h.spec, measure);
      } catch (error) {
        lines.push(
          `  ${h.id}: no se pudo evaluar (${error instanceof Error ? error.message : ''})`,
        );
        continue;
      }
      // `insufficient_n` is the expected answer for months and is NOT news. Saying it every
      // night would train him to skip this block, and then the one night it changes he skips
      // that too.
      if (evaluation.verdict === 'insufficient_n') continue;
      // `unmeasurable` is deliberately NOT skipped alongside it: it means the measure could
      // not be taken at all, which is news about the ledger row itself rather than about the
      // sample growing, and it is the one verdict that will not fix itself with more games.
      lines.push(
        `  ${h.id}: ${verdictLabel(evaluation.verdict)} — n=${evaluation.n}, ` +
          `efecto ${Number.isFinite(evaluation.effect) ? evaluation.effect.toFixed(3) : '—'} ` +
          `(baseline ${h.baselineEffect.toFixed(3)} sobre n=${h.baselineN})`,
      );
      if (evaluation.unreadable > 0) {
        lines.push(
          `    ojo: ${evaluation.unreadable} partida(s) sin timeline quedaron fuera de esa n.`,
        );
      }
    }
  }

  const matchups = collectMatchups(db);
  const seen = new Set<string>();
  for (const row of rows) {
    const match = getRawMatch(db, row.matchId);
    if (match === null) continue;
    const me = match.info.participants.find((p) => p.puuid === puuid);
    const opponent = match.info.participants.find(
      (p) => me !== undefined && p.teamPosition === me.teamPosition && p.teamId !== me.teamId,
    );
    if (me === undefined || opponent === undefined) continue;
    const key = `${me.championName} vs ${opponent.championName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const priors = priorsKeyedLike(loadPriors(), [
      { champion: me.championName, opponent: opponent.championName },
    ]);
    const found = coverageFor(matchups, {
      account: label,
      champion: me.championName,
      opponent: opponent.championName,
      queue: 'soloq',
      priors,
    });
    if (found === null || found.gamesToNext === 0) continue;
    lines.push(
      `  ${key}: ${found.ownGames} en esta cuenta` +
        `${found.reps > found.ownGames ? `, ${found.reps} reps en total` : ''} — ` +
        `faltan ${found.gamesToNext} para pasar de ${found.confidence} a ${found.nextConfidence}`,
    );
  }

  if (lines.length === 0) {
    out('Sin novedades del ledger ni de cobertura.');
    return;
  }
  out('Lo que cambió:');
  for (const line of lines) out(line);
}

export const SUMMARY = 'sincroniza, captura el tag de cada partida y devuelve lo que salió caro';
export const USAGE = 'lol cerrar [cuenta]';
