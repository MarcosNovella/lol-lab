import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { collectMatchups, matchupsToCsv } from '../src/analysis/matchups.ts';
import { openDb } from '../src/store/db.ts';

/**
 * Writes the per-account matchup record to the vault as CSV.
 *
 * This is the engine half of the 2026-08-16 decision: performance counters leave the vault's
 * matchup and champ notes, because those notes are the KNOWLEDGE layer and the counters are
 * performance. `/lol` used to increment `partidas`/`wins` without looking at `cuenta`, so the
 * main's first ranked game would have merged a fresh-MMR climb into Platinum 2 numbers in
 * silence. Derived from the cache instead, the record carries the account on every row and
 * cannot drift, because there is no second copy anyone maintains by hand.
 *
 * The file is machine-owned: it is rewritten whole on every run and nothing should be edited
 * inside it. Everything a human writes about a matchup stays in the note.
 */

const VAULT = process.env['VAULT_PATH'] ?? 'C:/Users/Marcos/Documents/vault';
const TARGET = join(VAULT, '_raw', 'lol', 'matchup-record.csv');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const db = openDb();
const rows = collectMatchups(db);
const csv = matchupsToCsv(rows);

mkdirSync(dirname(TARGET), { recursive: true });
// Explicit LF. Node does not translate newlines, but this file is read by the vault and by
// whatever reads it in five years, and CRLF has bitten this project once already (G-010).
writeFileSync(TARGET, csv, { encoding: 'utf8' });

const accounts = new Map<string, { games: number; matchups: number }>();
for (const r of rows) {
  const seen = accounts.get(r.account) ?? { games: 0, matchups: 0 };
  seen.games += r.games;
  seen.matchups += 1;
  accounts.set(r.account, seen);
}

out(`wrote ${rows.length} rows to ${TARGET}`);
for (const [account, seen] of accounts) {
  out(`  ${account}: ${seen.matchups} matchup rows over ${seen.games} games`);
}
out('');
out('Reminder: reps may be summed across accounts (knowledge), wins may not (performance).');

db.close();
