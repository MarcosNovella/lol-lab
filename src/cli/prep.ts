import { collectMatchups } from '../analysis/matchups.ts';
import { sameChampion } from '../analysis/names.ts';
import { confidenceOf, prepMatchup } from '../analysis/prep.ts';
import { describePriorsProblem, priorFor, readPriors } from '../analysis/priors.ts';
import { openDb } from '../store/db.ts';
import { account as accountOf, CliError, labelOf, out } from './shared.ts';

/**
 * `lol prep <mi campeón> <campeón rival> [cuenta]` — what to know before the game.
 *
 * Three sources, never merged without saying so: his own record on the account he is about to
 * play (performance, one account only), his reps across every account (knowledge, pooled), and
 * the op.gg meta prior. `confidenceOf` states which of the three the estimate actually rests on.
 */

export function run(argv: string[]): void {
  const [championArg, opponentArg, accountArg = 'smurf'] = argv;
  if (championArg === undefined || opponentArg === undefined) {
    throw new CliError('uso: lol prep <mi campeón> <campeón rival> [cuenta]');
  }

  const db = openDb();
  try {
    const account = accountOf(db, accountArg);
    const label = labelOf(account);

    const rows = collectMatchups(db);
    // Resolve the arguments to the spellings the cache actually uses, so `twisted fate`,
    // `TwistedFate` and `twisted-fate` all work from the command line (G-016).
    const champion =
      rows.find((r) => sameChampion(r.champion, championArg))?.champion ?? championArg;
    const opponent =
      rows.find((r) => sameChampion(r.opponent, opponentArg))?.opponent ?? opponentArg;

    const read = readPriors();
    const prior = priorFor(read.priors, champion, opponent);

    const prep = prepMatchup(rows, { champion, opponent, account: label, prior });
    const confidence = confidenceOf(prep);
    const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');

    out(`${champion} vs ${opponent} — cuenta ${label}`);
    out('');

    if (prep.repsTotal === 0) {
      out('  Nunca lo jugaste, en ninguna cuenta.');
    } else {
      out(`  Reps totales (todas las cuentas): ${prep.repsTotal}`);
      out(`  En esta cuenta: ${prep.own.wins}/${prep.own.games}`);
      for (const other of prep.otherAccounts) {
        out(`  En ${other.account}: ${other.wins}/${other.games}  (no se suma: es rendimiento)`);
      }
      if (prep.lastSeen !== null) {
        out(`  Última vez en esta cuenta: ${new Date(prep.lastSeen).toISOString().slice(0, 10)}`);
      }
    }

    out('');
    // "There is no prior for this matchup" and "I could not read the priors file at all" are
    // different facts and the estimate below depends on which one it is: without the meta the
    // shrinkage falls back to his own record and `confidenceOf` says his record rules, which
    // is a wrong confidence label rather than a missing one.
    const priorsProblem = describePriorsProblem(read.problem);
    if (priorsProblem !== null && read.problem.kind !== 'ausente') out(`  ${priorsProblem}`);
    if (prep.prior === null) {
      out('  Sin prior de op.gg para este matchup.');
    } else {
      out(
        `  Meta op.gg (platino): ${pct(prep.prior.winRate)} sobre ${prep.prior.sampleGames} partidas`,
      );
    }

    out('');
    out('  Estimación con shrinkage, barrida por peso del prior:');
    for (const e of prep.estimates) {
      out(
        `    peso ${String(e.weight).padStart(2)}: ${pct(e.winRate).padStart(6)}` +
          `   (${pct(e.ownWeight)} de tu propio registro)`,
      );
    }

    out('');
    const says: Record<typeof confidence, string> = {
      sin_datos: 'No puedo decir nada: no hay ni registro propio ni prior.',
      solo_meta: 'Esto es el meta, no vos. No jugaste el matchup en esta cuenta.',
      poco_propio: `Sin prior de op.gg, así que esto es sólo tu registro — y son ${prep.own.games}. Faltan ${prep.gamesToHalf} para que valga algo.`,
      mayormente_meta: `Esto es casi todo meta: tu registro pesa ${pct(prep.ownWeight)}. Faltan ${prep.gamesToHalf} partidas para que pese la mitad.`,
      mixto: `Mezcla: tu registro pesa ${pct(prep.ownWeight)}. Faltan ${prep.gamesToHalf} para la mitad.`,
      mayormente_propio: `Tu registro manda (${pct(prep.ownWeight)} del estimado).`,
    };
    out(`  ${says[confidence]}`);
  } finally {
    db.close();
  }
}

export const SUMMARY = 'el matchup antes de jugarlo: tu récord, tus reps y el meta, sin mezclarlos';
export const USAGE = 'lol prep <mi campeón> <campeón rival> [cuenta]';
