import { coverageGaps } from '../src/analysis/coverage.ts';
import { collectMatchups } from '../src/analysis/matchups.ts';
import { sameChampion } from '../src/analysis/names.ts';
import { openDb } from '../src/store/db.ts';
import { findAccount } from '../src/store/matches.ts';
import { loadPriors } from './priors.ts';

/**
 * `lol coverage [account]` — every matchup on this account too thin to trust, worst first.
 * The aggregate view of what `prep.ts` says one matchup at a time: "no puedo decirte nada de
 * Diana vs Sylas, jugaste 2, faltan 8 para que tu registro pese la mitad" for the whole pool
 * at once, instead of having to think to ask about one matchup.
 *
 * Usage: node scripts/coverage.ts smurf
 */

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const [, , accountArg = 'smurf'] = process.argv;

const db = openDb();
const account = findAccount(db, accountArg);
if (account === null) throw new Error(`no account '${accountArg}' in cache`);
const label = account.label ?? account.gameName;

const rows = collectMatchups(db);
const priors = loadPriors();
const priorOf = (champion: string, opponent: string) =>
  priors.find((p) => sameChampion(p.champion, champion) && sameChampion(p.opponent, opponent)) ??
  null;

const gaps = coverageGaps(rows, label, priorOf);

out(`Cobertura de matchups — cuenta ${label}`);
out('');

if (gaps.length === 0) {
  out('  Nada por debajo del umbral: cada matchup jugado ya pesa mayormente tu propio registro.');
} else {
  const says: Record<(typeof gaps)[number]['confidence'], string> = {
    sin_datos: 'no debería pasar aquí (games > 0 implica algún dato)',
    solo_meta: 'no debería pasar aquí (games > 0 implica algún dato)',
    mayormente_meta: 'casi todo meta',
    mixto: 'mezcla',
    mayormente_propio: 'no debería pasar aquí (ya filtrado)',
  };
  for (const g of gaps) {
    out(
      `  ${g.champion} vs ${g.opponent} — jugaste ${g.ownWins}/${g.ownGames} (${says[g.confidence]}), ` +
        `faltan ${g.gamesToHalf} para que tu registro pese la mitad`,
    );
  }
}

db.close();
