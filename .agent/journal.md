# Journal — full session episodes

Append-only. `state.md` stays compact by pushing the detail here. Newest last.

---

## 2026-08-16 · S2 + S3 — planning, then Fase 0 shipped

Two sessions' worth of work in one sitting: a planning half Marcos approved, then the build.

### What was discussed and decided

Marcos asked for a plan for "software to get better at League", naming matchups, teamfights,
vision and farming as his targets, plus "whatever else the data says is holding me back". He
came in with a diagnosis: *"I win lane against almost everyone and win half my games, so my
leak is what I do AFTER winning lane."* That came from the previous session's benchmark,
which reported him ahead of his lane opponents in 17 of 18 metrics at a 52.8% win rate.

**That diagnosis was overturned before any code was written.** Re-running his own 36 cached
mid/soloq games split by result showed:

- His CS@10 is IDENTICAL in wins and losses (67.8 ± 8.6 vs 69.5 ± 13.0, medians 67/70).
- His OPPONENT's is not (56.5 vs 68.6) — the variable separating his results was not his.
- In the 17 defeats he beat the enemy mid on cs/min 7 times, damage 7, KDA 6.
- The "17 of 18" was the mean being dominated by stomps: enemy mid KDA 1.10 in his wins.
- Every single defeat has 5-10 deaths (SD 1.56); no defeat under 5, no exceptions.

The reframing: not one leak after laning, but TWO POPULATIONS of game. Early lead in ~1/3
(converted 83%), even lane in ~2/3 (won 37.5%). The leak is the EVEN game — macro,
teamfights, vision, matchup. His instinct about WHAT to improve was right; the causal story
under it was built on a contaminated statistic.

**Four decisions Marcos made** (asked as explicit choices, all four the recommended option
except the last):

1. **Three layers** — this repo becomes the local engine; athlete-os receives only a daily
   aggregate through the ADR-024 import path so its ADR-025 pattern engine correlates life
   data against LoL outcomes with zero new statistics; the vault stays the decision layer.
   (ADR-006.)
2. **~30s of manual input per session** — one tap per game (lost by me / lost anyway / even)
   plus tilt 1-5 at session close. It is the only thing that separates "I played badly" from
   "I got a bad team". (ADR-007.)
3. **Markdown in the terminal + writes to the vault.** No dashboard. (ADR-007.)
4. **The last smurf week is RECORDED, NOT DIRECTED** — the one place he chose against the
   recommendation. Consequence: nothing built this week may change how he plays, and the
   week's games are a clean baseline. This turns out to be lucky (see roadmap §1).

Plan written to `C:\Users\Marcos\.claude\plans\lol-lab-plan.md`, approved wholesale
("me pareció todo muy bueno"), with instructions to build Fases 0-2 this week because the
main starts the week of 2026-08-17 and after that it is too late.

Two judgement calls made without asking, both stated to him:
- **The `riot-mcp` -> `lol-lab` rename is deferred to end of week.** The path is wired into
  `~/.claude.json`; moving it mid-build breaks the live MCP registration for zero functional
  gain.
- **Fases 0-2 run together** with verify green at each milestone; Fase 3+ waits until after
  the main starts.

### M0 — timelines

Found the blocker immediately: `syncMatches` fetches a timeline only inside its loop over
`missing` (matches being downloaded for the FIRST time), so the 71 already-cached matches
could never gain one — passing `withTimeline: true` on a later sync is a no-op for them. The
whole project depends on timelines and there were zero.

Built `matchIdsMissingTimeline` (store) + `backfillTimelines` (sync) + the
`riot_backfill_timelines` tool: walks the CACHE rather than Riot's id list, idempotent,
resumable, skips remakes, bails after 5 failures with 0 fetched (a dead key, not noise).
**67 timelines backfilled in 40.7s.**

Then the verification the plan demanded BEFORE building the event layer on top — measured
across all 67 timelines, not one (ADR-008):

- `frameInterval` is 60000ms on every match. Participant POSITION is sampled once a minute
  and nothing finer is reconstructable.
- **Better than planned**: CHAMPION_KILL carries its own exact timestamp AND position
  (4364/4364), so fight clustering does NOT depend on frame sampling — the plan's
  "clustering will be approximate" risk is retired. And `victimDamageReceived` lists every
  participant who damaged the victim (4364/4364), making "was he IN this fight" answerable
  exactly, including fights where he neither killed, assisted nor died.
- **Worse than planned**: WARD_PLACED and WARD_KILL carry NO position — 0 of 13457 ward
  events across the corpus. Ward heatmaps and the planned "muerto a oscuras" metric (deaths
  with no friendly ward covering the area) are **cut, not deferred**. Rejected the tempting
  workaround of inferring ward position from the creator's frame position at the nearest
  minute: up to 60 seconds of walking between the two, an invented number dressed as a
  measurement. Plan document updated in place.

### M1 — contamination class and the state-conditioned benchmark

The methodological core, and the reason the whole session mattered.

`Metric.contamination` is now a REQUIRED field, one of `causal | contaminated | conditional`.
Of the 18 metrics **only 4 are causal** (cs_first_10, early_lane_adv, lane_adv,
turret_plates). `benchmark()` refuses to put a contaminated metric in `weakest`/`strongest`
unless the caller declares a `stratum`. `tests/contamination.test.ts` fails the suite if that
filter is relaxed, if a metric is added unclassified, or if the whole-game rate metrics are
silently reclassified.

New modules: `analysis/state.ts` (lane state at a fixed minute; returns null rather than
extrapolating when the game ended early — a 12-minute stomp must never be filed as an even
game) and `analysis/conversion.ts` (conversion by state, with a MANDATORY band sweep).

Three pre-existing tests failed because they asserted `cs_per_min` could headline the report.
Per R7 they were not weakened: each now asserts BOTH halves of the new contract — that it
does not rank without a stratum, and that it does with one. They cover more than before.

### THE FASE 0 ANSWER

36 of 36 games have a minute-14 state. Bucketed by gold difference vs the lane opponent:

| | atrás | pareja | arriba |
|---|---|---|---|
| him | 2/10 (20%) | 3/6 (50%) | **14/20 (70%)** |
| his opponents, same state | | | **8/10 (80%)** |

He is ahead at minute 14 in 20 of 36. He converts 70%; his opponents from the same state
convert 80%. Direction holds at every band swept (68/73, 70/80, 71/75, 73/83).

The obvious confound was checked and runs the WRONG way for him: his leads are BIGGER (mean
+1871 vs +1410, median +1945 vs +1057) and he converts them worse. Restricted to comparable
lead sizes the gap survives: small leads (+500-1500) he converts 4/8 (50%), opponents 5/7
(71%).

Team state at 14 dominates: lane ahead + team ahead = 12/15 (80%); lane ahead + team behind
= 2/5 (40%). By champion from ahead: Locke 8/11, Diana 6/9 and 0/3 from behind.

**So "wins lane, loses game" IS real — as lead CONVERSION, quantified — but not for the
reason the contaminated means suggested.** All of it is a candidate at n=20 and n=10, where
10 points of conversion is 2 games.

### Errors made this session, and what they cost

- Annotated the 18 metrics with a Python script opened in text mode; Windows turned the whole
  file CRLF and `biome check` failed on all of `metrics.ts` rather than on the real change.
  Fixed with `pnpm fix`. Born: **G-010**.
- Wrote a justification comment claiming the 500-gold band sat "at the natural gap in the
  histogram". Checked it: the histogram is smooth from 0 to ~2250 with no gap. The comment
  was a rationalisation of a taste decision. Rewritten to say so outright, and
  `SENSITIVITY_BANDS` + `conversionByBand` + `conversionIsRobust` exist specifically so no
  finding can rest on that arbitrary cut.
- The previous session's "percentil 97 en ventaja de oro+XP" was a percentile over a BINARY
  0/1 flag. Born: **G-009**.

### Ledger

ADR-006 (three layers), ADR-007 (capture/output contract), ADR-008 (timeline capability map),
ADR-009 (state-conditioned headline metric). G-008 (contamination), G-009 (challenges field
distributions), G-010 (CRLF). Tests 33 -> 59, `pnpm verify` green. Nothing committed to git.
