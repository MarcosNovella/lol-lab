# State

Goal: grow this repo from "MCP over the Riot API" into `lol-lab`, the engine that says what
to do differently NEXT game. Plan APPROVED 2026-08-16:
`C:\Users\Marcos\.claude\plans\lol-lab-plan.md`. Marcos wants Fases 0-2 built THIS week,
before the main starts (week of 2026-08-17).

Accounts: `LegendofTorcuato#LAS` (smurf = practice, Platinum 2) and `LaMarso#LAS` (main =
the climb, level 301, unranked). LAS => `la2` / `americas`.
Cross-account rule, SETTLED 2026-08-16 after Marcos moved it twice — final form:
**KNOWLEDGE pools across accounts, PERFORMANCE does not.** Matchup reps, what the opponent
does and when, combos, builds, the minute the matchup turns => pool freely, they do not
change with elo. Win rate, gold/CS/XP diffs, conversion, anything peer-relative => always
split by account. Unsure? A number produced by how a game WENT is performance; a fact about
how the matchup WORKS is knowledge. Full rule + implementation shape in roadmap §5b.
The main IS ladder-serious from game 1 (an earlier "main = practice" line was a slip).

Log:
- 2026-08-14 S1: BUILT AND SHIPPED end to end, commit 684c9e3 — scaffold, client, SQLite
  store, analysis layer, 7 MCP tools, ADR-001..005, G-001..005/007, verify green (33 tests).
- 2026-08-14 S1b: key pasted, both accounts resolved, 71 matches cached, benchmark run on 36
  mid-soloq games. Both S1 open questions answered — see Standing.
- 2026-08-16 S2: planning. Overturned the benchmark's headline conclusion, wrote the plan.
- 2026-08-16 S3: FASE 0 SHIPPED (M0+M1), verify green 33 -> 59 tests. ADR-006..009,
  G-008/009/010. Committed as `28c67fa` and merged fast-forward to `master`, now at `8a0018d`.
  No remote exists — there is no backup off this machine. Details below.

Last done: Fase 0 closed.
- M0: found that `syncMatches` fetches timelines only inside its loop over NEW matches, so
  the 71 cached ones could never gain one. Added `matchIdsMissingTimeline` +
  `backfillTimelines` + the `riot_backfill_timelines` tool (idempotent, resumable, bails
  after 5 failures with 0 fetched). Backfilled 67 timelines in 40.7s.
- M0 verification (ADR-008): measured the timeline's real contents across all 67 before
  designing anything on top. Fight clustering is EXACT (CHAMPION_KILL carries its own
  timestamp + position, 4364/4364) and `victimDamageReceived` makes "was he in this fight"
  answerable exactly, including fights he neither killed nor died in — better than planned.
  But WARD_PLACED/WARD_KILL carry NO position (0 of 13457), so ward heatmaps and the planned
  "muerto a oscuras" metric are CUT, not deferred. Plan updated.
- M1: `Metric.contamination` (causal | contaminated | conditional) required on all 18 —
  only 4 are causal. `benchmark()` will not rank a contaminated metric without an explicit
  `stratum`; tests/contamination.test.ts fails the suite if that is relaxed or if a new
  metric is added unclassified. New `analysis/state.ts` (lane state at a fixed minute, never
  extrapolated) and `analysis/conversion.ts` (conversion by state + mandatory band sweep).

THE FASE 0 ANSWER (36 mid soloq games, all 36 have a minute-14 state):
He is AHEAD at 14 in 20 of 36. From ahead he converts 70%; his opponents from the same state
convert 80%. The direction holds at every band swept (68/73, 70/80, 71/75, 73/83). The
obvious confound runs the WRONG way for him: his leads are BIGGER (mean +1871 vs +1410) and
he converts them worse, and the gap survives inside comparable lead sizes (small leads
+500-1500: he 4/8 = 50%, opponents 5/7 = 71%). Team state at 14 dominates the outcome: lane
ahead + team ahead = 12/15 (80%), lane ahead + team behind = 2/5 (40%). By champion, from
ahead: Locke 8/11, Diana 6/9 and 0/3 from behind. So "wins lane, loses game" IS real — but
as lead CONVERSION, quantified, not as the contaminated-mean story we started with.
ALL OF IT IS A CANDIDATE, NOT A CONCLUSION: n=20 and n=10, and 10 points of conversion is 2
games. This is the first thing the Fase 3 hypothesis ledger must test out-of-sample.

Next: READ `roadmap.md` BEFORE BUILDING — it holds the forward agenda, the open decisions
that need Marcos, and a §4 listing where this session may have been wrong (challenge it, do
not inherit it). Full episode detail is in `journal.md`.
Order: (1) roadmap §1, time-critical — register the conversion finding in a minimal
hypothesis ledger BEFORE more games arrive, because this smurf week is the only clean
out-of-sample window that will ever exist; (2) commit the uncommitted Fase 0 working tree;
(3) M2, the derived event layer, which turns "you convert 70%" into "min 23:40, you died
alone with the team +3k".

Open questions:
- Rename `riot-mcp` -> `lol-lab`: DEFERRED to end of week on purpose — the path is wired into
  `~/.claude.json` and moving it mid-build breaks the live MCP registration for no gain.
- The `riot` MCP server registered in Claude Code predates today's tools, so
  `riot_backfill_timelines` is only reachable via `pnpm call` until Claude Code restarts.
- Whether S1's step-4 cross-check against `vault/_raw/lol/opgg-matches-2026-08-14.csv` ever
  ran — recorded nowhere. Cheap to redo; treat as pending.

Standing:
- Marcos's last smurf week is a CLEAN BASELINE: he chose "record, do not direct", so nothing
  built this week may change how he plays.
- Rate limit 20 req/s AND 100 req/2min per region, dev and personal keys alike. Dev keys
  expire every 24h; the server re-reads `.env` per request. Personal key requested, not yet
  arrived. Key pasted 2026-08-16 14:08 is live.
- ANSWERED (S1 q1): `LaMarso#LAS` retains 11 old matches (9 normals, 1 ARAM, 1 quickplay),
  most recent April 2026. No ranked history.
- ANSWERED (S1 q2): `laneMinionsFirst10Minutes` IS populated (36/36). But
  `laningPhaseGoldExpAdvantage` and `earlyLaningPhaseGoldExpAdvantage` are BINARY 0/1 flags,
  identical to each other in all 36 games — G-009.
- Timelines: 67 cached, `frameInterval` 60000ms on every one. Full capability map in ADR-008.
- The op.gg MCP is permanently unusable as tools; `vault/90-meta/scripts/opgg_pull.py` talks
  JSON-RPC by hand and stays the way in. op.gg and Riot are complementary, not redundant.
