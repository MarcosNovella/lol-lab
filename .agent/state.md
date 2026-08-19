# State

Goal: grow this repo from "MCP over the Riot API" into `lol-lab`, the engine that says what to
do differently NEXT game. Plan APPROVED 2026-08-16: `~/.claude/plans/lol-lab-plan.md`.

Accounts: `LegendofTorcuato#LAS` (smurf = practice, Platinum II) and `LaMarso#LAS` (main = the
climb, level 301, unranked). LAS => `la2` / `americas`. The main is ladder-serious from game 1.
Cross-account rule, SETTLED: **knowledge pools across accounts, performance does not.** Matchup
reps, what the opponent does and when, combos, builds, the minute the matchup turns => pool.
Win rate, gold/CS/XP diffs, conversion, anything peer-relative => always split by account.
Tie-break: a number produced by how a game WENT is performance; a fact about how the matchup
WORKS is knowledge. Full rule + implementation shape in `roadmap.md` §5b. It is enforced by
construction, not by discipline: `MATCHUP_PERSPECTIVE` is a mapped type over every numeric field
of `MatchupRow`, so a new number fails `tsc` until classified, and `pool()` cannot build the
numerator of a cross-account win rate.

## What exists

`src/analysis/*` is the engine and is pure and I/O-free; everything else is a front-end over it
(ADR-006). Three of them, no duplicated arithmetic: `src/server.ts` (MCP, 14 tools), `src/cli.ts`
(`lol cerrar · report · prep · cobertura · growth · page · hip · rank · ui`) and `src/ui/*` (the
local panel, ADR-018).

Analysis modules: `state`/`conversion` (lane state at a minute, `restOfTeamGoldDiff` with his own
lane pair removed) · `events`/`moments` (deaths, fights, expensive moments) · `curve` (state
curve, `biggestSwing`, `phaseSplit`) · `macro` (objectives, vision timing, tempo, roams) ·
`matchups` + `prep` (own record, pooled reps, op.gg prior, shrinkage, `confidenceOf`) ·
`growth` (per-account curve vs the lane opponent, `drift` and `trendSlope`) · `hypotheses` +
`measures` (the ledger, one measure dispatching on a frozen spec) · `capture` (play sessions and
reported tags) · `coverage` · `rank` · `render` (SVG + its CSS) · `names` · `priors` · `metrics`
(every metric declares `contamination`).

Cache: SQLite at `data/riot.db`, gitignored and single-machine. As of the sync of 2026-08-19
00:05 UTC: 86 matches, 82 timelines (the 4 missing are remakes), 2 accounts, 7 hypothesis rows
(5 live, 2 retired), 3 rank snapshots. Last game: 2026-08-17 19:49 ART. 75 smurf ranked games
(57 soloq + 18 flex) and 11 on the main. `riot_sync` defaults to `withTimeline: false`, so a
sync must be followed by `riot_backfill_timelines` or the new games have no minute data.

## The ledger

Five live rows, one retired. None can resolve for months, and `insufficient_n` is the correct
answer by design, not a broken tool.

| id | dir | baseline | n | needs |
|---|---|---|---|---|
| `lead_conversion_gap` | lower | −0.100 | 30 | 300 |
| `lead_conversion_gap_gold` | lower | −139.4 | 26 | 800 |
| `diana_needs_a_lead` | lower | −0.500 | 5 | 25 |
| `ward_before_objective_60s` | higher | +0.072 | 269 | 1200 |
| `team_state_dominates_500g` | higher | +0.318 | 19 | 88 |

FIRST OUT-OF-SAMPLE EVALUATION, 2026-08-19 (six games of 2026-08-17): conversion n=4 effect
0.000 · conversion-gold n=4 effect +1342 (sign flipped against its own baseline) · Diana n=1
effect −0.500 (he played her again, and lost from even-or-behind) · ward n=30 effect **+0.115
against a baseline of +0.072, same direction** · team state n=0. Every verdict is
`insufficient_n`, which is the designed answer, and the ward row is the only one accruing n at a
rate that can ever resolve.

Two retirements, both for a wrong `gap_games` and both re-registered with the spec unchanged:
`ward_before_objective` stored 0 because `countGapGames` sent a vision spec down the lane-state
path; `team_state_dominates` stored 3 when the truth was 7, because it was registered while the
key was expired and the cache stopped six games short (G-027).

## What the data has actually said

- **The minute-14 conversion finding FAILS a minute sweep** (14/20 vs 8/10 at minute 14, sign
  positive at 12 and 16). Registered as a direction under noise, never as a finding.
- **Phases, 39 mid soloq games, CS/min vs his own lane opponent: línea +0.70 · medio +0.35 ·
  cierre −0.11.** His edge halves after laning and is gone by the close — monotonic decay, not a
  collapse. Post-14 CS is contaminated (converting a lead means roaming and farming less), and
  the result-split version mostly restates "when he wins he is ahead". The one shape worth a
  hypothesis and still not registered: the deaths gap between wins and losses PEAKS in the mid
  phase (1.14 vs 2.71, 2.4×, against 1.6× in lane and 1.3× in the close).
- **Macro: 7.2 of 9.3 epic monsters have no ward from him in the preceding 60 s — 77%**, and it
  is 74% in wins against 81% in losses, so it is a habit with room rather than a cause of
  defeats. First back 2.41′ against his opponent's 2.03′. Everything else in that table is
  duration- or result-contaminated and says so.
- **No growth trend.** OVERTURNED 2026-08-18: the "his CS@10 edge is decaying at −0.147 per
  game" reading was two endpoints of a rolling mean. Fitted over all 39 points it is **+0.030**,
  the opposite sign, and it flips again by window (+0.083 / +0.030 / −0.015 at 5 / 10 / 20).
  G-025. Nothing about a decaying lane edge should be repeated.
- **Rank clock (deduplicated on VALUE, so a row means something changed):** smurf soloq
  Platinum II 82 LP (25W-24L), smurf flex Silver I 29 LP (6W-11L), main unranked. The flex gap
  is three divisions and is empirical support for the vault's rule 10.
- **The op.gg cross-check PASSES** — Locke 14/29, Yone 1/7, Diana 6/14 and five more, exact once
  window, flex gap and remakes are aligned. op.gg timestamps game END and the cache
  `gameCreation`, so a naive time join scores 0/20 on games that are in fact identical.
- **Death map**: 201 deaths over 39 games, 110 own half / 91 enemy, 62% within 2500 of the mid
  axis — which is what a mid laner's map should look like.

## Sessions

- **S1/S1b 2026-08-14** — built end to end: scaffold, client, SQLite store, analysis layer, MCP
  tools, ADR-001..005. Key pasted, both accounts resolved.
- **S2/S3 2026-08-16** — plan; FASE 0: timeline backfill, `Metric.contamination`, state and
  conversion layers. ADR-006..009.
- **S4 2026-08-16** — AUDIT (`roadmap.md` §0): the conversion finding fails, plus four defects.
  ROADMAP §1 BUILT: the hypothesis ledger, spec frozen by hash. ADR-010, G-011..014.
- **S5 (M4) 2026-08-16** — matchups with the account rule machine-checked, `prep`, `names.ts`
  (G-016), per-account growth (ADR-012), rank clock. M2: events, moments, curve, macro, the
  report sentence, ADR-013. UI as a static page at his request, ADR-014. G-015, G-017.
- **S6 2026-08-18, CLOUD container** — D1 settled: nube = código, local = datos. `lol cerrar` as
  the ONE ritual (D2, ADR-016), capture with reported tags fenced off structurally (ADR-015),
  coverage, A3 settled with `restOfTeamGoldDiff`, the `lol` CLI, six MCP tools, the engine never
  writes markdown to the vault (D4, ADR-017). G-019/020.
- **S7 2026-08-18, CLOUD** — `lol ui`: a `node:http` server on 127.0.0.1, tagging by click, sync
  by SSE, the reading sections. ADR-018 + D6/D7/D8. Token per boot, `Origin` check on POSTs, the
  key never reaches the browser. G-021..024. Three defects only a screen could show: the client
  script did not compile inside its template literal, the death map rendered as a black square
  for want of its CSS, and 70 tag cards were a wall.
- **S8 2026-08-18, HIS MACHINE** — below.

## S8 — the first session on his machine since the engine grew

`pnpm verify` green here, Node 24.14.1, 261 tests. Everything below ran against the REAL cache,
which is what the last two sessions could not do.

- **`team_state_dominates` REGISTERED** (spec `c2df1b2688a43d89`, baseline +0.318 over n=19, gap
  3, needs 88). Both bands swept as G-011 requires: 75 cells over minute × band × teamBand, all
  positive, in the frozen corpus and the full cache alike. The registered cell is among the
  smallest, so a later verdict cannot be knob-picking. Baseline in plain numbers: 10/12 with the
  rest of the team ahead against 4/8 with it behind.
- **`growth_drift` NOT registered, and that is the result.** Registering it required sweeping the
  rolling window, and the sweep killed it (see above, G-025). `trendSlope` was added and the
  ledger measure now fits every point; the growth REPORT keeps `drift`, which is a description of
  two endpoints and says so.
- **The UI, measured on the 68 MB cache** — the S7 question "cuánto tarda la curva y el mapa" has
  a number: `/api/graficos` 222 ms cold and 1 ms after the memo, `/api/cobertura` 80/54 ms (not
  memoised, the slowest steady-state route), `/api/momentos` 33/22 ms, `/api/prep` ~55 ms,
  everything else ≤ 8 ms. The panel lists both accounts with their ranks, counts 75 games pending
  a tag, and correctly reports the key as 54 h old and probably expired.
- **G-018 was violated by `guardrails.md` itself**: its own line carried a raw NUL where it meant
  to show the escape, so git had been treating the ledger of rules as a BINARY file. Byte fixed,
  and `tests/encoding.test.ts` now scans `.agent/` too.
- **G-026 born here**: a `cd` persisted between shell calls, `biome check .` ran where there was
  nothing to lint, and it printed nothing at all with exit 0. "No output" was one sentence away
  from being reported as "no warnings". Silence is not a pass.

### S8b — key pasted, and the pipeline ran end to end on live data

- **The key leaked into a TRACKED file.** He pasted it into `.env.example` as well as `.env`, and
  `.env.example` is committed to a public GitHub repo. Scrubbed back to the empty placeholder
  before anything was committed, so nothing left the machine. `.env` is the only file that ever
  holds the value, and it is gitignored.
- **Synced**: 6 new soloq games (2026-08-17), flex and main unchanged, timelines backfilled by
  hand because `riot_sync` defaults `withTimeline: false`. 86 matches, 82 timelines.
- **HE RANKED UP: Platinum II 82 LP → PLATINUM I 38 LP** (25W-24L → 28W-27L). The rank clock
  caught it because it deduplicates on value, so this row means something actually changed. Flex
  unchanged at Silver I.
- Of the six games, four were mid soloq (2W-2L, including a Diana loss), one was TOP and one
  UTILITY Senna — the role filter keeps those out of every mid comparison, which is why the
  report shows four.
- Matchup record re-exported to the vault: 71 rows, main and smurf never merged.
- **TAGGING: the backlog was closed by decision, see S8d.** The six new games are inside it, so
  they carry no tag and never will. Tagging starts with the next game he plays, by click.
- **A pattern was spotted in the new reports and then KILLED by its own denominator.** Four of
  the six games contain a death with the team 7-13k up handing over 600-1100 gold, and across 43
  mid soloq games 21% of his deaths happen with the team ≥3k ahead, carrying the highest average
  bounty (609 against 319-471 elsewhere) and 29.8k of gold given away — the largest bucket of
  the five. Divided by EXPOSURE it evaporates: 1.48 deaths per 10 minutes spent ≥3k ahead
  against 1.47 while even and 2.54/2.99 while behind. He does not die more often per minute of
  being ahead; he spends 332 of 1339 minutes there and a bounty scales with his own lead. No
  hypothesis registered, and the "expensive death while ahead" line should not be repeated as
  behaviour.

### S8c — the phase shape, and the second finding it killed

`PhaseSpec` + `phaseDeathRate` built (six tests, 267 total). The shape asks: among games he
reaches minute 14 with a lane lead, is his win rate higher in the games where he dies less per
ten minutes of a phase? Three decisions make it a question rather than a restatement of the
result — a lane GATE, a RATE over the minutes the game actually reached (G-017 clamping), and a
frozen threshold.

**Nothing was registered, because the mid phase is not special.** Every cell of the sweep is
positive — four phases × four gates × four thresholds × two corpora — and the phase-by-phase
numbers at the natural cell are +0.24 in lane, +0.27 in mid and +0.31 in the close. The 2.4×
"mid-phase peak" from 2026-08-16 was counts against duration; as a rate it says only that he
wins the games he dies less in, which is a tautology wearing a phase label. G-028. The shape
stays: it is what any future phase question gets registered through, and it is what made the
kill measurable.

### S8d — the backlog is closed by decision, not by tagging it

He said it plainly once the UI existed: he does not remember the older games and will tag from
now on. ADR-019 turns that into a dated fact instead of a permanent debt.

- `settings` table + `tag_cutoff`. `untaggedGames` excludes games that ENDED before the cutoff
  (a game still running when he decides stays askable), `abandonedByCutoff` counts what was left,
  and `ignoreCutoff: true` still reaches the whole backlog for anything that wants it.
- `POST /api/dejar-atras` + the button in the fold where the backlog is already shown. The
  account cards say `dejadas atrás: N (a propósito)` so the number never becomes a silent zero.
- **APPLIED on his cache**: 81 games left behind by decision (71 smurf, 10 main). Pending went
  81 → 0 and the panel now lists NO urgent action, which is the true state of things. Undoing it
  is one row: set `tag_cutoff` to 0, or delete it.
- Everything downstream inherits it for free — `lol cerrar`, the MCP's pending list and the
  panel all read `untaggedGames`.

verify green, 274 tests.

## Open questions
- **Diana**: closed by D3 as "the ledger decides", with the caveat that at n=5 needing 25, and 8
  games since he last played her, it may never reach n.
- Still believed on trust, never verified: ADR-008's ward-position claim (the basis of a
  permanent scope cut), the "+500-1500 small leads 4/8 vs 5/7" line, the individual
  `contamination` labels.
- `data/` is gitignored and single-machine, and a cloud session cannot check a single number. A
  derived, versionable export is the cheap fix; whether it gets committed is his call.
- `git config user.name` is unset ON HIS MACHINE, so his commits are authored by `unknown`.
- `package.json` declares `engines: >=24`; the cloud container runs Node 22.22 and the whole
  suite passes there too.
- Biome is at ZERO warnings since S8 (`teamGoldDiffAt` no longer advertises a `puuid` it never
  read). ~90 `useLiteralKeys` infos remain and are noise; `pnpm fix` would touch nine files to
  silence them, which is a diff nobody asked for.
- One historical revision (`688c21c`) holds `matchups.ts` as a BINARY blob. Cosmetic, and
  cleaning it would mean a force-push on a public repo.
- Repo still named `riot-mcp` locally while GitHub calls it `lol-project`; rename to `lol-lab`
  deferred (the path is wired into `~/.claude.json`).
- **athlete-os is PAUSED** until his WHOOP arrives. M5 and Fase 4 are off the table; build
  nothing that touches it.
- **The VAULT is a different repo and stays local** — it holds `10-salud` and `20-finanzas` and
  must never be pushed without a separate, explicit instruction.
