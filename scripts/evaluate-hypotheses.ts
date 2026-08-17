import { evaluateHypothesis, evaluationsOf, listHypotheses } from '../src/analysis/hypotheses.ts';
import { standardMeasure } from '../src/analysis/measures.ts';
import { openDb } from '../src/store/db.ts';

/**
 * Evaluates every live hypothesis against the games played since it was registered, and
 * appends the result. Safe to run as often as you like — it is append-only, and re-running it
 * on an unchanged cache simply records the same numbers again with a new timestamp.
 *
 * Expect `insufficient_n` for months. That is the correct output, not a broken tool: the
 * baseline effects are small enough that hundreds of games are needed before a direction may
 * be claimed, and a ledger that hands out verdicts early is a ledger that launders noise.
 */

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const db = openDb();
const measure = standardMeasure(db);
const live = listHypotheses(db);

if (live.length === 0) {
  out('ledger empty — run scripts/register-hypotheses.ts first');
} else {
  for (const h of live) {
    // The spec is passed back in explicitly, so a drifted call site fails loudly (G-013)
    // instead of quietly measuring something the hypothesis never claimed.
    const e = evaluateHypothesis(db, h.id, h.spec, measure);
    const shortfall = Math.max(0, h.nNeeded - e.n);
    const effect = Number.isFinite(e.effect) ? e.effect.toFixed(3) : 'not measurable yet';

    out(`${h.id}`);
    out(`  ${h.claim}`);
    out(
      `  registered ${new Date(h.registeredAt).toISOString()} · baseline ${h.baselineEffect.toFixed(3)} (n=${h.baselineN}) · ${h.gapGames} game(s) in the declared gap`,
    );
    out(`  out of sample: n=${e.n}, effect ${effect}`);
    out(`  verdict: ${e.verdict}${shortfall > 0 ? ` — ${shortfall} more games needed` : ''}`);
    const history = evaluationsOf(db, h.id);
    if (history.length > 1) {
      out(`  history: ${history.map((x) => `n=${x.n}`).join(' -> ')}`);
    }
    out('');
  }
}

db.close();
