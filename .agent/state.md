# State

Goal: grow this repo from "MCP over the Riot API" into `lol-lab`, the engine that says what to
do differently NEXT game. Plan APPROVED 2026-08-16: `~/.claude/plans/lol-lab-plan.md`.
Fases 0-2 wanted this week, before the main starts (week of 2026-08-17 — that is now).

Accounts: `LegendofTorcuato#LAS` (smurf = practice, Platinum 2) and `LaMarso#LAS` (main = the
climb, level 301, unranked). LAS => `la2` / `americas`. The main is ladder-serious from game 1.
Cross-account rule, SETTLED: **knowledge pools across accounts, performance does not.** Matchup
reps, what the opponent does and when, combos, builds, the minute the matchup turns => pool.
Win rate, gold/CS/XP diffs, conversion, anything peer-relative => always split by account.
Tie-break: a number produced by how a game WENT is performance; a fact about how the matchup
WORKS is knowledge. Full rule + implementation shape in `roadmap.md` §5b.

Log:
- 2026-08-14 S1/S1b: built and shipped end to end — scaffold, client, SQLite store, analysis
  layer, 7 MCP tools, ADR-001..005. Key pasted, both accounts resolved, 71 matches cached.
- 2026-08-16 S2: planning. Overturned the "ahead in 17 of 18" headline (G-008). Wrote the plan.
- 2026-08-16 S3: FASE 0 SHIPPED — timeline backfill + `Metric.contamination` + state/conversion
  layers. ADR-006..009, G-008/009/010. `f4cc6c5` on `master`. Produced the minute-14
  conversion finding (14/20 vs 8/10).
- 2026-08-16 S4: AUDIT (`roadmap.md` §0) — the conversion finding FAILS a minute sweep, plus
  four more defects. Then ROADMAP §1 BUILT: the hypothesis ledger, three findings registered.
  ADR-010, G-011..014. verify green, 59 -> 88 tests. UNCOMMITTED.

Last done: roadmap §1 shipped. `hypotheses` + `hypothesis_evaluations` tables,
`src/analysis/hypotheses.ts` (register · evaluate · retire, spec frozen by hash) and
`src/analysis/measures.ts` (ONE measure dispatching on the spec, so identical hash implies
identical computation). Three hypotheses registered 2026-08-17 10:30 ART, baselines computed by
the same function that will evaluate them and matching the audit exactly:
`lead_conversion_gap` −0.100 (n=30, needs 300) · `lead_conversion_gap_gold` −139.4 (n=26, needs
800) · `diana_needs_a_lead` −0.500 (n=5, needs 25). The three games of 2026-08-16 sit in a
declared, counted gap, excluded from both sides. First evaluation runs clean and reads
`insufficient_n, n=0` for all three — which is the correct answer for months, by design.
Also fixed on the way: `conversionIsRobust` → `conversionSurvivesBandSweep`, which no longer
blesses a gap of zero (G-012) and is named for the one knob it actually turns (G-011).

Also done (vault repo, separate commit pending): the account leak was closed defensively.
`/lol` step 2 and 3 incremented `partidas`/`wins` WITHOUT looking at `cuenta`, so the main's
first game would have merged silently. New vault rule 12 + guards in `.claude/commands/lol.md`
+ changelog S-008. No value migrated or rewritten — the existing counters were always this
account's, since it was the only one. Found beyond the roadmap's brief: `champ` notes have the
identical leak and the biggest counters in the vault (Locke 29/14, Diana 14/6); roadmap §5b
only flagged `matchup`.

DECIDED 2026-08-16 (Marcos, option B): performance counters LEAVE the vault notes. Built:
`src/analysis/matchups.ts` (one row per champ × opponent × role × ACCOUNT × queue, with
`repsAcrossAccounts` as the only cross-account aggregate and deliberately no wins counterpart)
+ `scripts/export-matchup-record.ts` → `vault/_raw/lol/matchup-record.csv`, 62 rows, main and
smurf never merged. Vault side: rule 12 rewritten, `/lol` steps 2-3 no longer touch counters,
counter keys out of both templates and out of three `lol.base` views, S-009. Nothing deleted —
existing keys are frozen historical, per the vault's own migration invariant.

RESOLVED, and the vault was RIGHT. The "8 of 19 notes disagree" report was my own scope error
(G-015): the notes are a last-20-games op.gg snapshot, I compared them to a full-season derived
count, the cache was missing 6 flex games, and op.gg excludes remakes while my query included
them. Corrected: 18 of 19 matchup notes match their source exactly (only `locke-vs-veigar` is
missing its soloq 0/1), and all 8 champion totals reconcile to the game. Decision B still
stands, but on the honest reason — the note never recorded its own window, `matchup` has no
`alcance` key, and the main's 10 matchups were invisible. S-009 corrected in place.

**The op.gg cross-check from S1 step 4 is DONE and it PASSES** — the last open verification of
the pipeline against an independent source. Locke 14/29, Yone 1/7, Diana 6/14, and five more,
all exact once window, flex gap and remakes are aligned. Also found and fixed on the way: the
flex history was incomplete (12 of 18 cached); now 69 smurf ranked games, 51 soloq + 18 flex.
Also learned: op.gg timestamps game END, the cache `gameCreation` — a naive time join scores
0/20 on games that are in fact identical.

M4 mostly BUILT (2026-08-16), still uncommitted:
- The hard requirement, machine-checked: `MATCHUP_PERSPECTIVE` is a mapped type over every
  numeric field of `MatchupRow`, so a new number fails `tsc` until classified; `pool()` refuses
  to sum a `rendimiento` field across accounts, which makes a pooled win rate unreachable
  because its numerator cannot be built; `breakdown()` is the answer to a performance question.
- `src/analysis/prep.ts` — own record (one account only) + reps (pooled) + op.gg meta prior +
  shrinkage, weight swept 5/10/20 per G-011, `confidenceOf` stating what the n allows.
- `scripts/prep.ts` — `lol prep <champ> <rival> [cuenta]`. Verified live on three cases:
  Locke vs Akali on the smurf (0/2, estimate 36.3%, "casi todo meta, faltan 8"), a two-word
  champion typed as `"twisted fate"`, and Locke vs Akali on the MAIN, where the smurf's 0/2 is
  shown, explicitly not summed, and the estimate is the bare prior.
- `src/analysis/names.ts` + G-016 — one `championKey` for Riot PascalCase, op.gg spaced and the
  vault kebab slug. This is the bug that produced the false vault discrepancy report.
- Fixed a float artefact in `prep.ts`: with n=0 the weighted mean returned 0.43500000000000005,
  so "no games of your own means the estimate IS the prior" was true in intent and false on
  inspection. R7 — the code was fixed, not the test.
- Roadmap §2's "season growth curve across both accounts" was STALE and contradicted §5b, which
  withdrew the merged curve. Struck in place.
- Per-account growth DONE: `src/analysis/growth.ts` + `scripts/growth.ts`. Cannot span accounts
  by construction; refuses a non-causal metric (G-008); both series drawn on ONE shared scale
  so a flat pair cannot read as divergence. ADR-012.

**M4 is closed.** verify green, 119 tests (59 at session start).

FIRST REAL READING off the curve (smurf, CS@10, mid, 39 games, rolling 10): his line drifts
DOWN 70.0 → 66.7 while his opponents' drifts UP 58.0 → 60.3 — net −0.147 per game. It is a
description of two endpoints, not a finding: rolling means are endpoint-sensitive and this is
one metric. It is exactly the shape of thing the ledger exists for, and registering it would
need a `growth_drift` outcome in `measures.ts` — not built.

RANK CLOCK STARTED 2026-08-16: `rank_snapshots` + `src/analysis/rank.ts` + a script that runs
alongside sync. Deduplicates on VALUE, so syncing four times an evening he did not play writes
one row, and a row means "this changed". First reading — smurf soloq **Platinum II 82 LP
(25W-24L)**, smurf flex **Silver I 29 LP (6W-11L)**, main unranked. The flex gap is three
divisions and is empirical support for the vault's rule 10. `rankAt` returns null for a game
older than the first snapshot rather than reaching forward: a division recorded afterwards is
what happened later, not evidence about the game.

M2 STARTED — the two pieces that carry the central deliverable:
- `src/analysis/events.ts` — typed primitives. The rule it enforces: a quantity read from a
  frame is at most half a frame away in time, fine for gold, NOT fine for position. Positions
  come only from events that carry one (ADR-008).
- `src/analysis/moments.ts` — `deathsOf` (exact timestamp, position, team gold, alone-ness
  defined from EVENTS not frame positions, bounty, objective lost after), `fightsOf` (time+space
  clustering, presence via `victimDamageReceived` so a player who damaged and neither killed nor
  died still counts), `expensiveMoments`. ADR-013.
- `scripts/report.ts` — the plan's headline sentence, working on real games:
  *"min 17:30 moriste solo con el equipo +6.6k entregando 806 de oro y perdieron dragon en los
  2 min siguientes [-2632 de oro]"*.
- Caught and fixed mid-build: the ≥3-kill fight threshold from the plan had been dropped, so a
  24-minute game reported 35 "fights". Verified the clustering itself afterwards (62 kill events
  vs 62 kills summed over ten players, all clustered) — the defect was the threshold.

verify green, 141 tests.

M2 continued: `src/analysis/curve.ts` — `stateCurve` (gold/xp/cs vs the lane opponent at
5/10/14/20/25/30 plus team gold, with the minutes the game never reached listed rather than
omitted), `biggestSwing`, and `phaseSplit` (0-14 / 14-25 / 25+ with the opponent's CS/min beside
his, since the rate alone is contaminated). Wired into `scripts/report.ts`.

G-017 born here, and it mattered: `phaseSplit` derived game length from `frames.length - 1`,
but a timeline appends a trailing PARTIAL frame, so a 24:01 game read as 25 minutes, minute 25
had no frame, and the whole 14-25 phase was dropped in silence. It only fired for games ending
just after a minute boundary, so it looked like missing data. **The fix changed the answer**:
the mid phase went from n=33 to n=39 and its CS/min gap from +0.03 to +0.35; the closing phase
from n=14 to n=29. The buggy version said his lane edge VANISHES after 14. It does not.

FIRST PHASE READING (39 mid soloq games, CS/min vs his own lane opponent):
línea +0.70 · medio +0.35 · cierre −0.11. His edge halves after laning and is gone by the
close — a monotonic decay, not a collapse. This answers the plan's §2.E open question. Caveats
that must travel with it: post-14 CS is contaminated (a player converting a lead roams and
farms less, so a shrinking gap can be him doing the right thing), and the result-split version
(wins +1.34/+0.94/+0.76 vs losses −0.13/−0.42/−0.82) is contaminated end to end and mostly
restates "when he wins he is ahead". The one shape worth a hypothesis: the deaths gap between
wins and losses PEAKS in the mid phase (1.14 vs 2.71, 2.4×, against 1.6× in lane and 1.3× in
the close). Not registered in the ledger yet.

**UI SHIPPED** at his request (ADR-014): `src/analysis/render.ts` + `scripts/page.ts` → one
self-contained HTML file, two views, no deploy/framework/build step. Gold curve vs the lane
opponent, and the death map (201 deaths over 39 games, 110 own half / 91 enemy). Two tested
correctness points: the projection FLIPS Y (League's y grows up, SVG's grows down — without it
the map is upside down and top lane reads as bot), and positions are NOT mirrored to normalise
his side, because SR lanes are absolute and shared; `isOwnHalf` computes the team-relative fact
instead of moving the point. Bounds measured first (x 430..14153, y 514..14247 over 2493 events).
Sanity check after: 62% of his deaths sit within 2500 of the mid axis, which is what a mid
laner's map should look like.

**M2 CLOSED**: `src/analysis/macro.ts` — `objectivesOf` (credited participation, and "died
within 30s before" instead of modelling respawn timers), `visionOf` (timing only), `tempoOf`,
`roamsOf` (the one legitimate use of frame positions: occupancy over a minute, never placing an
event in space). Wired into the report. Item completion timings are CUT, not deferred:
ITEM_PURCHASED carries only an itemId and this repo caches no Data Dragon, so component vs
legendary is unknowable without inventing the item table.

Two defects found and fixed while building it, both by checking output that looked wrong:
- `tempoOf` returned minute 0 for every first back. The opening buy is NOT at timestamp 0 — it
  lands at ~2031ms — so `timestamp > 0` returned the fountain purchase. `PREGAME_MS = 30_000`.
- The module comment claimed `wardType: UNDEFINED` on 27% of placements limited his vision
  analysis. Checked: all 2088 belong to OTHER players, zero to him. G-015 strengthened — the
  scope rule now covers a single statistic carried onto a subset it does not describe.

FIRST MACRO READING (39 games, and the contamination is flagged): the one stable habit is that
**7.2 of 9.3 epic monsters have no ward from him in the preceding 60 seconds — 77%, and it is
74% in wins against 81% in losses**, so it is a habit with room rather than something that
explains defeats. First back 2.41′ against his opponent's 2.03′. Everything else in that table
is duration- or result-contaminated and says so: objectives taken (6.9 wins vs 4.2 losses),
enemy-half occupancy (0.50 vs 0.25) and even control wards (2.2 vs 3.1, because losses run
4.4 minutes longer) are all downstream of the result.

Next: commit both repos — riot-mcp now has 14 new files and 141 tests uncommitted, and there is
still no remote. Then the rest of M2.

Open questions:
- **A3 still undecided and it blocks a third hypothesis.** `teamGoldDiff` contains his own lane
  pair (r=0.65 with laneGoldDiff; net of the pair his teammates are +605 vs +47), so
  `team_state_dominates` was deliberately NOT registered — freezing a spec on a variable we
  intend to change would make the hash refuse to evaluate after the fix, costing the clock we
  just started. Decide `restOfTeamGoldDiff` before M2 builds `state_curve`, then register it.
- **Diana may be moot**: last Diana game 2026-08-10, zero in the last 8. `roadmap.md` §3.1's
  question may already be answered by his behaviour. `diana_needs_a_lead` may never reach n=25.
- No MCP tool reads the ledger yet — it is reachable only via `scripts/register-hypotheses.ts`
  and `scripts/evaluate-hypotheses.ts`. Deliberate: the registered `riot` server predates
  today's tools anyway and needs a Claude Code restart to see new ones.
- Still unverified and believed on trust: ADR-008's ward-position claim (basis of a permanent
  scope cut), the S1 step-4 op.gg cross-check (no record it ever ran), the "+500-1500 small
  leads 4/8 vs 5/7" line, the individual `contamination` labels.
- **No git remote, and option B just made it matter more.** `vault/_raw/` is gitignored, so
  `matchup-record.csv` is neither versioned nor backed up — the counters moved from tracked
  markdown to an ignored directory. Regenerable in principle, but only from `riot-mcp/data/`,
  which is ALSO gitignored and sits in a repo with no remote, and Riot's match-v5 does not
  serve history indefinitely. The whole chain is single-machine. Either back up riot-mcp, or
  un-ignore `_raw/lol/*.csv` in the vault so derived aggregates are versioned while true raw
  series stay out. Marcos's call; worth doing before more is built on top.
- Dev key expires ~14:00 today (pasted 2026-08-16 14:08). Personal key still not arrived.
- Rename `riot-mcp` → `lol-lab`: deferred to end of week (path wired into `~/.claude.json`).
