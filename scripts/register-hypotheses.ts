import {
  getHypothesis,
  listHypotheses,
  type RegisterInput,
  registerHypothesis,
  type Spec,
} from '../src/analysis/hypotheses.ts';
import { countGapGames, standardMeasure } from '../src/analysis/measures.ts';
import { openDb } from '../src/store/db.ts';
import { findAccount } from '../src/store/matches.ts';

/**
 * Registers findings as dated predictions. One-shot per id: the ledger is append-only, so a
 * second run reports what already exists and changes nothing. It grows as claims arrive — the
 * three Fase 0 ones, then the vision window, then `team_state_dominates` on 2026-08-18.
 *
 * ONE claim that was queued for registration is deliberately absent. `growth_drift` (his CS@10
 * gap decaying at -0.147 per game) did not survive the sweep its own registration required:
 * the number was the first and last point of a rolling mean, and a line fitted over all 39
 * points comes out at +0.030, the opposite sign, flipping again by window (G-025). There is no
 * direction to predict, so nothing is registered. The measure stays — it is the estimator that
 * changed, and it will have something to say when there are enough games for a trend to exist.
 *
 * Two boundaries, not one:
 * - BASELINE_UNTIL freezes the corpus the claims were actually made on (36 mid soloq games,
 *   the last of them 2026-08-14 22:42 ART). It is deliberately NOT moved forward to include
 *   later games, because moving a baseline to a place where the number looks better is the
 *   whole disease this ledger exists to treat.
 * - `testFrom` is the moment of registration. Three games were played today, hours after the
 *   findings existed and before they were registered; they are post-finding so they are not
 *   clean baseline, and pre-registration so they are not clean test. They land in a declared
 *   hole, counted into `gap_games` so nobody later wonders where they went.
 */

const BASELINE_UNTIL = Date.parse('2026-08-15T00:00:00-03:00');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const db = openDb();
const smurf = findAccount(db, 'LegendofTorcuato#LAS');
if (smurf === null) throw new Error('smurf account not in cache — run a sync first');

const base = {
  puuid: smurf.puuid,
  role: 'MIDDLE',
  queueId: 420,
  minute: 14,
  band: 500,
} as const;

const SPECS: Record<string, Spec> = {
  ward_before_objective_60s: {
    puuid: smurf.puuid,
    role: 'MIDDLE',
    queueId: 420,
    windowSeconds: 60,
    onlyUncredited: true,
  },
  lead_conversion_gap: { ...base, outcome: 'binary_win', stratum: 'none', champion: null },
  lead_conversion_gap_gold: {
    ...base,
    outcome: 'delta_gold_6min',
    stratum: 'none',
    champion: null,
  },
  diana_needs_a_lead: {
    ...base,
    outcome: 'binary_win',
    stratum: 'lane_even_or_behind',
    champion: 'Diana',
  },
  team_state_dominates_500g: {
    puuid: smurf.puuid,
    role: 'MIDDLE',
    queueId: 420,
    minute: 14,
    band: 500,
    // 500g across the four teammates is the same band his own lane uses, and it is the
    // CONSERVATIVE cell of the sweep rather than the flattering one: every wider team band
    // reports a bigger gap (0.389 at 1000, 0.467 at 1500, 0.667 at 2000).
    teamBand: 500,
  },
};

const CLAIMS: Record<
  string,
  { claim: string; direction: 'lower' | 'higher'; nNeeded: number; caveat: string }
> = {
  ward_before_objective_60s: {
    claim:
      'Among epic monsters he was NOT credited on, his team takes a HIGHER share of the ones he warded for in the preceding 60 seconds than of the ones he did not.',
    direction: 'higher',
    // h is about 0.14 on the baseline, so roughly 770 per group. At ~9 epics a game with 23%
    // warded that is hundreds of games -- but the n accrues about nine per game instead of half
    // a lane state, so this is the first hypothesis here that can actually resolve.
    nNeeded: 1200,
    caveat:
      'The window is arbitrary and was swept: the gap is +0.124 at 30s, +0.082 at 60s, -0.006 at 90s and +0.006 at 120s, so the effect lives only in the short windows. That decay is at least coherent with the mechanism -- a ward 30 seconds before an objective is for that fight, one two minutes before is routine -- unlike the minute-14 conversion gap, whose sign flipped between adjacent minutes for no reason. THE CONFOUND THAT REMAINS: warding near an objective correlates with being near it, and being near it correlates with the team taking it. Restricting to objectives he was not credited on removes the tautological part but not the rest -- he can be present without being credited -- so this is an association and the ward may be a marker of rotation rather than a cause. Registered anyway: the direction is stated in advance and out-of-sample games will speak.',
  },
  lead_conversion_gap: {
    claim:
      'From a >500g lane lead at minute 14, his win rate is BELOW his lane opponents rate from the same state.',
    direction: 'lower',
    // ~150 per bucket for a 10-point difference in proportions at 80% power. At roughly six
    // ahead-games a week that is months, not this smurf week. Stated as a number rather than
    // as a footnote, because a hypothesis that cannot resolve should say so up front.
    nNeeded: 300,
    caveat:
      'FAILS A MINUTE SWEEP: the sign of the gap is positive at 12 and 16, the two minutes either side of 14, and 16/18 hold more games in the binding bucket than 14 does. The whole 10-point gap is ONE game in a bucket of ten. Registered as a direction under noise, not as a finding. Two further caveats: (a) the opponents rate is derived by antisymmetry, not measured, so the opponent-quality confound is carried whole and nothing in this number controls for it; (b) Marcos was told the finding in conversation, so post-registration games mix "the pattern was real" with "he was told and reacted", and those cannot be separated afterwards.',
  },
  lead_conversion_gap_gold: {
    claim:
      'Same comparison, continuous outcome: his gold swing over the six minutes after a lead at 14 is BELOW his opponents swing from theirs.',
    direction: 'lower',
    // d is about -0.14 on the baseline, which needs ~400 per group.
    nNeeded: 800,
    caveat:
      'Registered to settle an argument with data. Roadmap 4.2 reasoned that a continuous outcome would extract more signal from the same games; measured, its standardised effect is d = -0.14, so it needs MORE games than the binary version, not fewer. If that reasoning was right this hypothesis should resolve first; it is registered precisely so the prediction is on the record either way. Shares the derived-opponent and told-him caveats of lead_conversion_gap, and flips sign at the same place in a minute sweep.',
  },
  team_state_dominates_500g: {
    claim:
      'Among games he is >500g AHEAD in lane at minute 14, his win rate with the REST of his team ahead by >500g is HIGHER than with the rest of his team behind by >500g.',
    direction: 'higher',
    // h = 0.73 on the baseline, so ~15 per group would settle the gap actually observed. 88 is
    // the n for a 20-point gap instead of a 33-point one: an in-sample effect is the largest
    // the data allows, and it shrinks out of sample. About 20 of every 39 mid soloq games land
    // in one of the two buckets, so this is months, not weeks -- but it is reachable, which is
    // more than lead_conversion_gap can say.
    nNeeded: 88,
    caveat:
      'BOTH BANDS SWEPT (G-011), frozen corpus, minute 14: over teamBand 250/500/1000/1500/2000 the gap runs 0.318 / 0.318 / 0.389 / 0.467 / 0.667 (n 19/19/15/8/7), and over lane band 0/300/500/750/1000 at teamBand 500 it runs 0.446 / 0.389 / 0.318 / 0.300 / 0.178. Minutes 12/14/16 at the registered cell give 0.304 / 0.318 / 0.524. Every one of the 75 cells is POSITIVE, in the frozen corpus and in the full cache alike -- the opposite of lead_conversion_gap, whose sign flipped between adjacent minutes. The registered cell is among the smallest of the grid, chosen so a later verdict cannot be an artefact of knob-picking. ' +
      'HOW MUCH OF THIS IS MECHANICAL: a team that is ahead wins more, so the SIGN is close to guaranteed and what is really on the record is the SIZE. It is worth tracking because the useful movement is DOWNWARD -- if he learns to close a game from a lane lead, his dependence on the rest of the map should shrink, and this number is where that would show. ' +
      'THE NAME OVERSTATES IT, and the mirror was measured rather than assumed: from lane-BEHIND games the same split gives 3/6 against 0/5, a gap of the same order, so team state is not doing something special to his lane leads. ' +
      'CONFOUND: `restOfTeamGoldDiff` removes his own lane pair (A3, r = 0.65 with laneGoldDiff was why this was unregisterable before), but the remaining gold is not exogenous either -- a mid who converts a lead by roaming makes his teammates richer, so part of "team ahead" is him. ' +
      'THE ID CARRIES A HISTORY: this was first registered as `team_state_dominates` on a cache that stopped at 2026-08-16, so its declared hole counted 3 states when the truth was 7 -- six games of 2026-08-17 had been played and not yet downloaded. It was retired at n=0, nothing was lost, and this registration ran immediately after a sync so the hole is counted against every game that exists. The lesson is general and now a rule: SYNC BEFORE REGISTERING (G-027). ' +
      'On the full cache after that sync the same cell reads 10/13 against 4/8, a gap of 0.269 rather than the frozen 0.318 -- the direction is what is registered, and the size is already drifting inside the noise the n implies.',
  },
  diana_needs_a_lead: {
    claim: 'On Diana, his win rate from a neutral-or-behind lane state at 14 is BELOW a coin flip.',
    direction: 'lower',
    nNeeded: 25,
    caveat:
      'Restated after the 2026-08-16 audit. The earlier framing, "Diana converts a lead worst (6/9)", is one game away from Locke (8/11) and is not a finding at all. What the baseline actually shows is 0 wins in 5 from even-or-behind, with all six of her wins coming from an existing lead, against Locke 3/7 in the same states. n=5 is nothing; this needs about twenty games in that state to say anything, and he has not played Diana since 2026-08-10, so it may never accumulate them. Centred on 0.5 rather than on Lockes rate, so the comparison does not depend on a second champion drifting.',
  },
};

const measure = standardMeasure(db);
const now = Date.now();

out(`baseline frozen at  ${new Date(BASELINE_UNTIL).toISOString()}  (end of the 36-game corpus)`);
out(`registering at      ${new Date(now).toISOString()}`);
out('');

for (const [id, spec] of Object.entries(SPECS)) {
  const meta = CLAIMS[id];
  if (meta === undefined) throw new Error(`no claim text for '${id}'`);

  if (getHypothesis(db, id) !== null) {
    out(`= ${id}: already registered, left untouched`);
    continue;
  }

  // The baseline effect comes out of the SAME measure, under the SAME frozen spec, as every
  // future evaluation will. Computing it any other way would compare two different numbers.
  const baseline = measure(spec, { from: 0, until: BASELINE_UNTIL });
  const gapGames = countGapGames(db, spec, BASELINE_UNTIL, now);

  const input: RegisterInput = {
    id,
    claim: meta.claim,
    direction: meta.direction,
    spec,
    baselineUntil: BASELINE_UNTIL,
    testFrom: now,
    gapGames,
    baselineN: baseline.n,
    baselineEffect: baseline.effect,
    nNeeded: meta.nNeeded,
    caveat: meta.caveat,
  };
  const saved = registerHypothesis(db, input, now);
  // Describe whichever shape the spec is. Reading lane-state fields off a vision spec printed
  // "minute undefined band undefined" and tsc had already said so -- Node strips types without
  // checking them, so the script ran anyway.
  const describeSpec = (s: Spec): string => {
    if ('windowSeconds' in s) {
      return `ventana ${s.windowSeconds}s  ${s.role}/${s.queueId}  solo-sin-crédito=${s.onlyUncredited}`;
    }
    if ('teamBand' in s) {
      return `minuto ${s.minute} banda ${s.band} banda-equipo ${s.teamBand}  ${s.role}/${s.queueId}`;
    }
    if ('rollingGames' in s) {
      return `métrica ${s.metricKey} ventana ${s.rollingGames} partidas  ${s.role}/${s.queueId}`;
    }
    if ('deathsPer10Threshold' in s) {
      return (
        `fase ${s.fromMinute}-${s.toMinute} corte ${s.deathsPer10Threshold} muertes/10min  ` +
        `puerta: banda ${s.band} al minuto ${s.gateMinute}  ${s.role}/${s.queueId}`
      );
    }
    return (
      `minuto ${s.minute} banda ${s.band}  ${s.role}/${s.queueId}  outcome=${s.outcome} ` +
      `stratum=${s.stratum} champion=${s.champion ?? 'any'}`
    );
  };
  out(
    `+ ${saved.id}\n` +
      `    spec      ${saved.specHash}  ${describeSpec(spec)}\n` +
      `    baseline  effect ${saved.baselineEffect.toFixed(4)} over n=${saved.baselineN}\n` +
      `    needs     n=${saved.nNeeded} before any verdict is allowed\n` +
      `    gap       ${saved.gapGames} game(s) excluded from both sides`,
  );
}

out('');
out('--- ledger ---');
for (const h of listHypotheses(db)) {
  out(
    `${h.id.padEnd(26)} ${h.direction.padEnd(6)} baseline ${h.baselineEffect.toFixed(3)} (n=${h.baselineN})  needs n=${h.nNeeded}  gap=${h.gapGames}`,
  );
}

db.close();
