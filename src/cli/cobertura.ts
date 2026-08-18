import { coverageOf, coverageTotals } from '../analysis/coverage.ts';
import { collectMatchups } from '../analysis/matchups.ts';
import { loadPriors, priorsKeyedLike, priorsPath } from '../analysis/priors.ts';
import { openDb } from '../store/db.ts';
import { account, labelOf, out } from './shared.ts';

/**
 * `lol cobertura [cuenta] [n]` — what the engine cannot speak about yet, and how far off it is.
 *
 * The point is that "I don't know" is a QUANTITY. Before this the tool would answer a matchup
 * question at n=1 with a number that was the op.gg prior wearing a personal label; now it says
 * how many games buy the next rung.
 */

export function run(argv: string[]): void {
  const db = openDb();
  try {
    const record = account(db, argv[0] ?? 'smurf');
    const label = labelOf(record);
    const limit = Number(argv[1] ?? 15);

    const rows = collectMatchups(db);
    const priors = priorsKeyedLike(
      loadPriors(),
      rows.map((r) => ({ champion: r.champion, opponent: r.opponent })),
    );
    const coverage = coverageOf(rows, { account: label, priors });
    const totals = coverageTotals(rows, coverage);

    out(`Cobertura — cuenta ${label}`);
    out(
      `  alcance: cola ${coverage.scope.queue} · ` +
        `${coverage.scope.since === null ? 'toda la historia en caché' : `desde ${new Date(coverage.scope.since).toISOString().slice(0, 10)}`} · ` +
        `remakes ${coverage.scope.remakes}`,
    );
    if (priors.length === 0) {
      out(`  sin priors de op.gg (${priorsPath()} no está) — todo se apoya en tu propio registro`);
    }
    out(
      `  ${totals.matchups} matchups vistos · ${totals.reps} reps en total (todas las cuentas) · ` +
        `${totals.silent} sobre los que no puedo decir nada`,
    );
    out();

    if (coverage.rows.length === 0) {
      out('  No hay matchups en caché para esta cuenta.');
      return;
    }

    out(`  Los ${Math.min(limit, coverage.rows.length)} más flojos:`);
    for (const row of coverage.rows.slice(0, limit)) {
      const reps =
        row.reps > row.ownGames ? `${row.ownGames} acá / ${row.reps} reps` : `${row.ownGames}`;
      const need =
        row.gamesToNext === 0
          ? 'ya manda tu registro'
          : `faltan ${row.gamesToNext} para ${row.nextConfidence}`;
      out(
        `    ${`${row.champion} vs ${row.opponent}`.padEnd(28)} ${reps.padEnd(16)} ` +
          `${row.confidence.padEnd(18)} ${need}`,
      );
    }
    out();
    out('  Las reps se suman entre cuentas (conocimiento); el récord no (rendimiento, ADR-011).');
  } finally {
    db.close();
  }
}

export const SUMMARY = 'qué matchups todavía no tienen datos suficientes, y cuántos faltan';
export const USAGE = 'lol cobertura [cuenta] [cuántos mostrar]';
