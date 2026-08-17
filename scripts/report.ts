import { biggestSwing, phaseSplit, stateCurve } from '../src/analysis/curve.ts';
import { clock } from '../src/analysis/events.ts';
import { objectivesOf, roamsOf, tempoOf, visionOf } from '../src/analysis/macro.ts';
import { normaliseRole } from '../src/analysis/metrics.ts';
import {
  deathsOf,
  expensiveMoments,
  fightsOf,
  TEAMFIGHT_MIN_KILLS,
  teamfights,
} from '../src/analysis/moments.ts';
import { openDb } from '../src/store/db.ts';
import {
  findAccount,
  getRawMatch,
  getRawTimeline,
  queryParticipants,
} from '../src/store/matches.ts';

/**
 * `lol report [account] [games] [role]` — the three most expensive moments of each recent game,
 * with the exact minute to scrub a replay to.
 *
 * Riot's `.rofl` replays are local and break on a patch change, so this is only useful within
 * the week it is generated. That is a property of the game, not of the tool, and the report
 * says so rather than pretending otherwise.
 */

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const [, , accountArg = 'smurf', gamesArg = '5', roleArg = 'mid'] = process.argv;
const limit = Number(gamesArg);
if (!Number.isInteger(limit) || limit < 1) throw new Error(`bad game count '${gamesArg}'`);

const db = openDb();
const account = findAccount(db, accountArg);
if (account === null) throw new Error(`no account '${accountArg}' in cache`);
const role = normaliseRole(roleArg);
if (role === null) throw new Error(`no role '${roleArg}'`);

const rows = queryParticipants(db, {
  puuid: account.puuid,
  role,
  queueId: 420,
  limit,
});

out(`Últimas ${rows.length} partidas de ${account.label ?? account.gameName} (${roleArg}, soloq)`);
out('');

for (const row of rows) {
  const match = getRawMatch(db, row.matchId);
  const timeline = getRawTimeline(db, row.matchId);
  const date = new Date(row.gameCreation).toISOString().slice(0, 10);
  const result = row.win === 1 ? 'victoria' : 'DERROTA';

  out(
    `${date}  ${row.champion.padEnd(8)} ${result.padEnd(8)} ${clock(row.gameDuration * 1000)}  ${row.matchId}`,
  );

  if (match === null || timeline === null) {
    out('   sin timeline en caché — nada que derivar');
    out('');
    continue;
  }

  const deaths = deathsOf(match, timeline, account.puuid);
  const clusters = fightsOf(match, timeline, account.puuid);
  const fights = teamfights(clusters);
  const pickoffs = clusters.length - fights.length;
  const present = fights.filter((f) => f.present).length;
  const { moments, unmeasurable } = expensiveMoments(match, timeline, account.puuid, 3);

  out(
    `   ${deaths.length} muertes · ${deaths.filter((d) => d.alone).length} solo · ` +
      `presente en ${present}/${fights.length} peleas (≥${TEAMFIGHT_MIN_KILLS} kills) · ` +
      `moriste primero en ${fights.filter((f) => f.diedFirst).length} · ` +
      `${pickoffs} picks sueltos aparte`,
  );

  const curve = stateCurve(match, timeline, account.puuid);
  if (curve.points.length > 0) {
    const shape = curve.points
      .map((p) => `${p.minute}′ ${p.goldDiff >= 0 ? '+' : ''}${p.goldDiff}`)
      .join('  ');
    out(`   vs ${curve.opponentChampion ?? '?'}:  ${shape}`);
    const swing = biggestSwing(curve);
    if (swing !== null) {
      out(
        `   mayor movimiento: ${swing.delta >= 0 ? '+' : ''}${swing.delta} de oro ` +
          `entre ${swing.from}′ y ${swing.to}′`,
      );
    }
  }

  const phases = phaseSplit(match, timeline, account.puuid);
  if (phases !== null) {
    const line = phases
      .map(
        (p) =>
          `${p.name} ${p.csPerMin.toFixed(1)}/${Number.isFinite(p.opponentCsPerMin) ? p.opponentCsPerMin.toFixed(1) : '?'} cs·min ${p.deaths}†`,
      )
      .join('  ·  ');
    out(`   ${line}`);
  }

  const objectives = objectivesOf(match, timeline, account.puuid);
  const epics = objectives.filter((o) => o.lane === null);
  const vision = visionOf(match, timeline, account.puuid);
  const tempo = tempoOf(match, timeline, account.puuid);
  const roams = roamsOf(match, timeline, account.puuid);

  const ours = epics.filter((o) => o.byOwnTeam);
  out(
    `   épicos ${ours.filter((o) => o.participated).length}/${ours.length} con crédito tuyo · ` +
      `${vision?.objectivesWithoutVision ?? '?'}/${epics.length} sin ward tuya en los 60s previos · ` +
      `${epics.filter((o) => o.diedJustBefore).length} con vos muerto 30s antes`,
  );
  if (tempo !== null && roams !== null) {
    const diff =
      tempo.firstShopMinute !== null && tempo.opponentFirstShopMinute !== null
        ? tempo.firstShopMinute - tempo.opponentFirstShopMinute
        : null;
    out(
      `   1ª vuelta a tienda ${tempo.firstShopMinute ?? '—'}′ vs ${tempo.opponentFirstShopMinute ?? '—'}′` +
        `${diff === null ? '' : ` (${diff >= 0 ? '+' : ''}${diff})`} · ` +
        `${(roams.byZone.mid * 100).toFixed(0)}% del tiempo en mid · ` +
        `${(roams.enemyHalf * 100).toFixed(0)}% en mitad enemiga`,
    );
  }

  if (moments.length === 0) {
    out('   sin momentos medibles');
  }
  for (const moment of moments) {
    out(`   min ${moment.at.padStart(5)}  ${moment.line}  [${moment.costGold} de oro]`);
  }
  if (unmeasurable > 0) {
    out(`   (${unmeasurable} muertes sin ventana de 2 min por delante, no rankeadas)`);
  }
  out('');
}

out(
  'Los replays .rofl son locales y se rompen al cambiar de parche: esto sirve dentro de la semana.',
);
db.close();
