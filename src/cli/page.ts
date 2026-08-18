import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { biggestSwing, stateCurve } from '../analysis/curve.ts';
import { normaliseRole } from '../analysis/metrics.ts';
import { deathsOf, describeDeath } from '../analysis/moments.ts';
import {
  type DeathDot,
  deathMapSvg,
  goldCurveSvg,
  isOwnHalf,
  type PageSection,
  renderPage,
} from '../analysis/render.ts';
import { DEFAULT_DB_PATH, openDb } from '../store/db.ts';
import { getRawMatch, getRawTimeline, queryParticipants } from '../store/matches.ts';
import { account as accountOf, CliError, labelOf, out } from './shared.ts';

/**
 * `lol page [account] [games] [role]` — writes a single self-contained HTML file.
 *
 * Deliberately NOT a dashboard (ADR-007). Two views only, the two things text does badly: the
 * gold differential against the lane opponent over time, and where he dies. Everything else
 * stays in the terminal report, where it reads better.
 *
 * No deploy, no framework, no build step (ADR-003): one file with inline CSS and inline SVG,
 * opened from disk.
 */

export function run(argv: string[]): void {
  const [accountArg = 'smurf', gamesArg = '10', roleArg = 'mid'] = argv;
  const limit = Number(gamesArg);
  if (!Number.isInteger(limit) || limit < 1) throw new CliError(`mala cantidad '${gamesArg}'`);

  const db = openDb();
  try {
    const account = accountOf(db, accountArg);
    const role = normaliseRole(roleArg);
    if (role === null) throw new CliError(`no existe el rol '${roleArg}'`);
    const label = labelOf(account);

    const recent = queryParticipants(db, { puuid: account.puuid, role, queueId: 420, limit });
    const all = queryParticipants(db, { puuid: account.puuid, role, queueId: 420 });

    // ---- gold curves, one card per recent game ---------------------------------------------
    const curves: PageSection[] = [];
    for (const row of recent) {
      const match = getRawMatch(db, row.matchId);
      const timeline = getRawTimeline(db, row.matchId);
      if (match === null || timeline === null) continue;

      const curve = stateCurve(match, timeline, account.puuid);
      const swing = biggestSwing(curve);
      const date = new Date(row.gameCreation).toISOString().slice(0, 10);
      curves.push({
        title: `${date} · ${row.champion} vs ${curve.opponentChampion ?? '?'} · ${
          row.win === 1 ? 'victoria' : 'DERROTA'
        }`,
        svg: goldCurveSvg(curve.points),
        meta:
          swing === null
            ? 'una sola lectura, sin movimiento que medir'
            : `mayor movimiento ${swing.delta >= 0 ? '+' : ''}${swing.delta} de oro entre ${swing.from}′ y ${swing.to}′`,
      });
    }

    // ---- the death map, over every game of this account+role -------------------------------
    const dots: DeathDot[] = [];
    let gamesWithTimeline = 0;
    for (const row of all) {
      const match = getRawMatch(db, row.matchId);
      const timeline = getRawTimeline(db, row.matchId);
      if (match === null || timeline === null) continue;
      gamesWithTimeline += 1;

      for (const death of deathsOf(match, timeline, account.puuid)) {
        if (death.position === null) continue;
        dots.push({
          position: death.position,
          // Per game, because which half is "his" depends on the side he was on that game.
          teamId: row.teamId,
          minute: Math.floor(death.timestamp / 60_000),
          costGold: death.costGold,
          label: describeDeath(death),
        });
      }
    }

    const ownHalf = dots.filter((d) => isOwnHalf(d.position, d.teamId)).length;
    const html = renderPage({
      title: `lol-lab — ${label} (${roleArg}, soloq)`,
      note:
        `Dos vistas, no un tablero. La curva de oro es contra el rival de tu misma línea, ` +
        `el mismo par que usa todo el resto del motor. El mapa junta ${dots.length} muertes de ` +
        `${gamesWithTimeline} partidas; el tamaño del punto es lo que costó en oro de equipo en los ` +
        `2 minutos siguientes, y el color, de qué lado del mapa fue. Las lanes son absolutas: el ` +
        `mapa no se espeja según tu lado, porque bot es bot para los dos equipos. Pasá el mouse ` +
        `por un punto para ver el detalle.`,
      groups: [
        {
          heading: `Mapa de muertes — ${dots.length} en ${gamesWithTimeline} partidas`,
          sections: [
            {
              title: 'Dónde morís',
              svg: deathMapSvg(dots),
              meta: `${ownHalf} en tu mitad · ${dots.length - ownHalf} en la mitad enemiga`,
            },
          ],
        },
        { heading: `Curvas de oro — últimas ${curves.length} partidas`, sections: curves },
      ],
    });

    const target = join(dirname(DEFAULT_DB_PATH), `lol-lab-${label}.html`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html, { encoding: 'utf8' });

    out(`escrito: ${target}`);
    out(`  ${curves.length} curvas · ${dots.length} muertes de ${gamesWithTimeline} partidas`);
    out(`  ${ownHalf} en tu mitad, ${dots.length - ownHalf} en la enemiga`);
  } finally {
    db.close();
  }
}

export const SUMMARY = 'un HTML local con la curva de oro y el mapa de muertes';
export const USAGE = 'lol page [cuenta] [partidas] [rol]';
