import { collectMatchups } from '../src/analysis/matchups.ts';
import { sameChampion } from '../src/analysis/names.ts';
import { confidenceOf, prepMatchup } from '../src/analysis/prep.ts';
import { openDb } from '../src/store/db.ts';
import { findAccount } from '../src/store/matches.ts';
import { loadPriors } from './priors.ts';

/**
 * `lol prep <my champion> <enemy champion> [account]` — what to know before the game.
 *
 * Usage: node scripts/prep.ts Locke Akali smurf
 */

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const [, , championArg, opponentArg, accountArg = 'smurf'] = process.argv;
if (championArg === undefined || opponentArg === undefined) {
  out('usage: node scripts/prep.ts <my champion> <enemy champion> [account]');
  process.exit(1);
}

const db = openDb();
const account = findAccount(db, accountArg);
if (account === null) throw new Error(`no account '${accountArg}' in cache`);
const label = account.label ?? account.gameName;

const rows = collectMatchups(db);
// Resolve the arguments to the spellings the cache actually uses, so `twisted fate`,
// `TwistedFate` and `twisted-fate` all work from the command line (G-016).
const champion = rows.find((r) => sameChampion(r.champion, championArg))?.champion ?? championArg;
const opponent = rows.find((r) => sameChampion(r.opponent, opponentArg))?.opponent ?? opponentArg;

const prior =
  loadPriors().find(
    (p) => sameChampion(p.champion, champion) && sameChampion(p.opponent, opponent),
  ) ?? null;

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
  mayormente_meta: `Esto es casi todo meta: tu registro pesa ${pct(prep.ownWeight)}. Faltan ${prep.gamesToHalf} partidas para que pese la mitad.`,
  mixto: `Mezcla: tu registro pesa ${pct(prep.ownWeight)}. Faltan ${prep.gamesToHalf} para la mitad.`,
  mayormente_propio: `Tu registro manda (${pct(prep.ownWeight)} del estimado).`,
};
out(`  ${says[confidence]}`);

db.close();
