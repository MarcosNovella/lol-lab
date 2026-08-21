# Roadmap — what to build, and what to ARGUE ABOUT, next session

Read after `state.md`. **§A is the live plan with hard dates — read it first.** §1 is the old
time-critical section, now historical. §2 is the build queue. §3 is the part that needs Marcos in
the room. §4 is where the last session thinks it may have been wrong — challenge it rather than
inheriting it.

---

## A. THE MAIN'S CLIMB — the plan with real dates (agreed 2026-08-19)

Marcos set two milestones, in his words: **Monday 24/08** he starts climbing on the main and
wants something "más o menos funcional"; **Monday 31/08** he wants "un software que sirva de
verdad y me pueda apoyar en él para mejorar y enfocarme en eso". Today is Wednesday 19/08, so
that is 4 days of build, then a week of real use, then a week of fixing.

Everything below was put to him and agreed. Do not re-litigate the framing; challenge the
numbers.

### A1. THE ONE THING WITH A HARD DEADLINE — Monday 24, before his first ranked game

**Every registered hypothesis carries the SMURF's puuid inside its frozen spec (G-013), so the
moment he switches accounts the ledger stops accruing forever.** The five live rows freeze where
they are — 30 of 300, 26 of 800, 269 of 1200, 19 of 88, 5 of 25 — and never resolve. That is the
correct rule, not a defect: performance never pools across accounts (ADR-011), different MMR and
different intent. But it means there is a dated, irreversible decision.

**On Monday 24, in this order: SYNC → REGISTER the same specs against the main's puuid → then he
plays.** G-027 is exactly why the order matters: `team_state_dominates` was once registered
against a stale cache and its declared hole recorded 3 states when the truth was 7. And if he
plays twenty games first and registers after, those twenty land INSIDE the baseline and are not
out-of-sample ever again.

It is also the cleanest boundary this project will ever get: new account, new elo, new regime,
day one. Prepare `scripts/register-hypotheses.ts` for the main BEFORE Monday, reviewed, so
Monday is one command and not a design session.

Open question for him, worth one minute on Monday: the smurf's five rows stay frozen at their
current n. Retire them with a reason, or leave them live and un-accruing? Leaving them live is
honest (nothing about them changed) but the panel will show five rows that can never move.

### A2. THE REAL RISK — the panel goes almost mute on a fresh account

The whole reading is built on the smurf's 86 games. With the main at zero:

- `benchmark` needs `MIN_GAMES` = 5, so nothing at all on the first night.
- Coverage says "no puedo hablar" about nearly every matchup: his own record on the main is 0.
- The growth curve smooths over 10 games, so it is meaningless until ~15.
- The tag split starts empty; the ledger says `insufficient_n` everywhere, correctly.

He opens the panel on Tuesday after eight games and five sections say "no sé". The natural
conclusion is "this does not work", and it would be a wrong conclusion about software that is
being honest. **This is a design gap, not a bug, and it is the main build item for 20-23/08.**

**What to build: a PER-GAME and PER-SESSION reading layer.** An aggregate needs n; a description
does not. "En esta partida perdiste 14 de CS al minuto 10 contra tu Yone, y a los 14 estabas 800
de oro abajo" is n=1 and is completely valid. What cannot be said at n=1 is "sos malo farmeando".
The existing pieces (`moments`, `stateCurve`, `phaseSplit`, `itemRace`) are already per-game and
already computed — the gap is that the panel spends them on aggregates.

### A3. What the smurf's history CAN give the main from game one

**Matchup reps pool across accounts; the record does not** (ADR-011, §5b, machine-checked by
`MATCHUP_PERSPECTIVE`). So `prep` against Yone already knows what 29 smurf games taught him —
what the opponent does and when, when the matchup turns. That works on Monday morning with zero
main games.

**It has to be in his face on Monday, not buried under "En champ select".** It is the only thing
that makes two weeks of smurf data pay off on day one of the climb.

### A4. The schedule

**Now → Sunday 23 — four days of build**
1. **Run everything on the REAL cache.** Nothing from S9/S9b/S9c/S9d/S9e/S9f has touched his 86
   games — briefing, upkeep chain, reading, phases, growth, tag split, all measured against
   fixtures and a seeded database. Biggest risk in the whole plan and not a feature.
2. **The per-game / per-session reading layer** (A2). Carries the main's entire first week.
3. **Make a zero-game account behave well**: what the panel says, offers and promises when an
   account has no history. G-019 was born in exactly that state.
4. **The main's re-registration script**, written and reviewed, ready to run Monday (A1).

**Monday 24 — he starts.** Sync, register, play. And that week we deliberately DO NOT code much:
he uses it and writes down what was missing. One week of real use is worth more than four days
of guessed features.

**Monday 24 → Sunday 30** — fix what real use exposed, plus the session-over-session reading
(week 1 vs week 2), plus the peer corpus if it fits (§A6).

**Monday 31 — the bar.**

### A5. What 31/08 can and cannot honestly deliver

With ~86 smurf games and ~20-30 on the main:

- **YES** per-game and per-session: what happened that night and where it went, with the minute.
- **YES** against the mids he actually faced on the main, with the n printed beside it.
- **YES** what he knows about each matchup, pooling smurf and main.
- **YES** what he SAID (tags) against what the engine MEASURED.
- **NO** ledger verdicts. They will read `insufficient_n` and that is the correct answer.
- **NO** smurf against main. Different elo; it cannot be done and never will be.

**The bar for 31/08, in one sentence, agreed with him:** *"después de cada sesión sé exactamente
qué pasó y dónde se me fue, y después de dos semanas veo si eso se repite o fue esa noche."*
NOT "the software tells me how to improve" — that arrives when the n arrives, and on 31/08 the
most that can be true is that the clock has been running clean since the main's first game.

### A6. The one move that buys n with code instead of with calendar

Every one of his matches holds NINE other players, and match-v5 serves their histories. At
100 requests per 2 minutes and 2 requests per game with timeline, that is **~1,500 games an
hour** — a few hours a day for three days is tens of thousands of Platinum games. `ward_before
_objective_60s` does not need 130 of HIS games at that point, it needs 130 of anyone's.

**The constraint that makes it legal here:** a hypothesis registered about HIM cannot be resolved
with other people's games — the `puuid` is inside the frozen spec (G-013). These would be NEW
rows, of a different class. And that class already exists and is settled: **knowledge pools,
performance does not** (ADR-011). "In Platinum, warding before an objective raises the rate of
taking it" is knowledge. "You ward less than your opponents" is performance. The first can be
bought with requests; the second only with his own games.

What it unlocks that nothing else can: telling apart "this is my leak" from "this is what
everyone in Platinum does". Today there is no way to know which.

Not a week-1 item. Week 2, or whenever the per-game layer is done.

### A7. What NOT to build, agreed

- **Never lower an `nNeeded`** to have verdicts by Friday. It is the one change that destroys the
  whole point of the ledger.
- **No overall "score".** It hides which part moved, which is the only thing worth knowing.
- **No match prediction or AI coaching.** At n=86 it is a generator of pretty sentences.
- **No cloud, no accounts, no multi-user.** Not the product.

---

## 0. AUDIT 2026-08-16 S4 — measured, not inherited. Read before §1.

Every number below was recomputed against the cache this session, not carried over.

**A1. The conversion gap does NOT survive a minute sweep — the test §4.1 asked for and S3
never ran.** Sign of (his conversion − theirs) at band 500, across the whole 36-game corpus:

```
min   8   10   12   14   16   18   20   25
gap   +    +    +    −    +    +    −    −
```

It is negative at 14 and positive at 12 and 16, its two immediate neighbours — and 16/18 hold
MORE games in the opponent bucket (11) than 14 does (10). The continuous outcome (Δgold over
the 6 min after the state) flips at the same place: d = −0.15, −0.38, −0.16, **−0.14**, +0.28,
+0.39, +0.20 for base minutes 8→20. Magnitude: the opponent bucket is 8/10, so **one game
erases the whole 10-point gap**. The band sweep does survive, but it is the weak test — band
300→1000 moves n from 22 to 15, while the minute genuinely re-shuffles membership.
Fair counter, recorded: 14 is theoretically motivated (laning ends) so other minutes are
arguably different questions. It does not rescue the finding — the project's own standard for
the band (`state.ts:34`, "a conclusion that only survives at one cut is not a conclusion")
applies at least as hard to the minute, which is no less arbitrary.
=> The claim becomes: *at n=20/10 the sign is not determined by the data.* Register it that
way. This does not cancel §1, it sharpens what §1 registers.

**A2. Diana is mischaracterised in §3.1 and in state.md.** "Converts a lead worst (6/9)" is
one game away from Locke's 8/11 — no signal there. The real split: **Diana 0/5 from
even-or-behind (0/2 even, 0/3 behind); all 6 of her wins come from already being ahead.**
Locke goes 3/7 in those same states. Diana's problem is not conversion, it is that she
produces nothing when the state is not handed to her — which is a different, more actionable
claim and lands squarely on the plan's "the leak is the even game".

**A3. ~~`teamGoldDiff` contains his own lane pair~~ — DONE 2026-08-18.** r = 0.65, so "team
state" and "lane state" were not independent. `LaneState.restOfTeamGoldDiff` now removes the
pair; `teamGoldDiff` stays because it has consumers. `TeamStateSpec` freezes both bands and
`team_state_dominates` is finally registerable. **REGISTERED, and live as
`team_state_dominates_500g`** (2026-08-19 00:09 UTC, spec `c2df1b2688a43d89`, baseline +0.318
over n=19, needs n=88, gap 7). The first id was retired the same evening at n=0: it had been
registered on a cache that stopped six games short because the key was expired, so its declared
hole said 3 when it was 7 (G-027 — sync before registering). Same spec hash, same baseline. Both bands swept as
required: all 75 cells of minute × band × teamBand are positive, in the frozen corpus and in the
full cache, and the registered cell is among the smallest. Note the remaining gold is not
exogenous either: a mid who converts a lead by roaming makes his teammates richer, so this is
less contaminated, not clean. Measured on the way and it tempers the name: from lane-BEHIND
games the same split gives 2/5 against 0/4, so team state is not doing something special to his
lane leads.

**A4. `conversionIsRobust` blesses a gap of exactly zero** — `Math.sign(0)` is 0 and `{0}` has
size 1, so it returns `true` for "no difference at all". `tests/conversion.test.ts:57-67` pins
it with a fixture where both rates are 1.0, so the test is green for the wrong reason. Fix
under R7: assert consistent sign AND non-zero. Note this is the OPPOSITE of the worry in §4.5.

**A5. The opponent baseline is derived, not measured**: gap = P(win|ahead) + P(win|behind) − 1.
`conversion.ts:105-115` says so plainly; state.md narrated it as two samples. Valid under
symmetry, but it means the opponent-quality confound (§4.3) is bigger than recorded, not
smaller — there is no opponent measurement in it at all.

**Verified exact** (ran the query): 36/36 have a minute-14 state, skip 0/0 · 14/20 and 8/10 ·
mean leads 1871 vs 1410 · 12/15 vs 2/5 by team state · Diana 6/14, Locke 11/18 · band sweep
all-negative · 67 timelines, the 4 missing all remakes (68s, 68s, 83s, 263s) so coverage is
complete in practice · `pnpm verify` green, 59 tests.

**NOT verified, still believed on trust**: the "small leads +500-1500: he 4/8, opponents 5/7"
line in state.md · ADR-008's ward-position claim (0 of 13457), which is the basis of a
permanent scope cut · the S1 step-4 op.gg cross-check (still no record it ever ran) · the
individual `contamination` labels in §4.4.

---

## 1. Do this FIRST, it is time-critical

**Register the conversion finding as a formal hypothesis, dated, BEFORE more games arrive.**
*(Revised by §0 — register the honest version, and freeze the spec.)*

The Fase 0 finding (he converts a minute-14 lead 70%, his opponents 80%) rests on n=20 and
n=10, and §0/A1 shows the sign flips with the minute. The plan's answer to exactly this is the
Fase 3 hypothesis ledger: every finding is registered as a dated PREDICTION and evaluated ONLY
against games played after that date.

**NEW REQUIREMENT from the audit — the ledger must freeze the ANALYSIS SPEC, not just the
claim.** The plan (`lol-lab-plan.md:313`) stores date · claim · metric · direction · effect ·
n_needed. A1 proves the missing fields are load-bearing: **minute, band, role, queue, account,
outcome variable**. Without them the out-of-sample evaluation inherits exactly the researcher
degrees of freedom that manufactured the finding. One extra column, half the value of Fase 3.

**Be honest in `n_needed`.** d ≈ 0.14–0.38 needs ~175 per group at 80% power; at ~6 ahead-games
a week that is months, not this smurf week. Put that in the field rather than in a footnote —
registering now buys an honest clock, not a verdict (§4.8 already said this; make it a column).

This is time-critical because of a lucky accident. Marcos chose to RECORD and not DIRECT his
last smurf week, so the games he plays right now are untouched by the finding — a genuine
out-of-sample set, the only one that will ever exist under the current regime. Once the main
starts, the regime changes (different MMR, different intent) and this window closes.

So the ledger's minimal slice — an append-only table plus a "register" and an "evaluate"
path — should be pulled FORWARD from Fase 3 to the very start of the next session, ahead of
M2. It is small: one table, two functions. Registering it late is not recoverable.

Register at minimum:
- `lead_conversion_gap`: from a >500g lane lead at 14, his win rate is BELOW his opponents'
  from the same state. Direction only. Needs ~15 further ahead-games to say anything.
- `diana_conversion`: Diana converts a lead worse than Locke. n=9 vs 11 today. Weak.
- `team_state_dominates`: lane-ahead + team-behind games are lost far more often than
  lane-ahead + team-ahead. n=5 vs 15 today.

**ALL OF THIS LIST IS REGISTERED, and one candidate was killed instead.** The ledger holds five
rows as of 2026-08-18: `lead_conversion_gap`, `lead_conversion_gap_gold`, `diana_needs_a_lead`,
`ward_before_objective_60s` and `team_state_dominates` (plus one retired). `growth_drift` was
queued and is NOT registered: its own registration sweep destroyed it. The -0.147 per game came
from subtracting the first point of a rolling mean from the last; a line fitted over all 39
points gives +0.030 — the OPPOSITE sign — and the window sweep runs +0.083 / +0.030 / -0.015
over 5 / 10 / 20 games. There is no direction to predict (G-025). The measure survives with a
fitted estimator and will have something to say when there are enough games for a trend to
exist; nothing about his lane edge "decaying" should be repeated in the meantime.

---

## 2. Build queue

Tasks #3-#6 exist in the task list. State as of session end:

**M2 — DONE 2026-08-16.** `events.ts` · `moments.ts` (deaths, fights, the 3 most expensive
moments) · `curve.ts` (state_curve, phases) · `macro.ts` (objectives, vision timing, tempo,
roams). Cut and NOT deferred, each for a measured reason: ward heatmaps and "died in the dark"
(no ward positions exist, ADR-008), item completion timings (no Data Dragon cached, so a
component cannot be told from a legendary), "was he alive at the objective" (needs the respawn
formula — replaced by "died within 30s before", which is measured). Fase 5 UI also shipped early
at his request, ADR-014. Original scope below, kept for the record:

**M2 — derived event layer from timelines** (next up, biggest piece)
Tables and parsers, all derived-immutable like the matches themselves:
- `state_curve` — gold/XP/CS vs the lane opponent at 5/10/14/20/25/30 + team gold diff.
- `deaths` — per death: minute, position, team gold state, solo or not, distance to nearest
  ally, seconds to the next objective spawn. NOT "covered by a ward" — impossible (ADR-008).
- `fights` — cluster CHAMPION_KILL by time+space (exact, per ADR-008). Per fight: present
  (via `victimDamageReceived`, exact), died first, damage in the window, result, and what
  happened to the objective in the next 60s.
- `objectives` — per dragon/herald/grubs/baron/tower: alive, distance at spawn and contest,
  participated, result.
- `phases` — CS/min, damage/min, deaths, gold share split 0-14 / 14-25 / 25+.
- `vision_events` — TIMING ONLY: wards relative to objective spawns, control-ward cadence by
  type, clear timing. No positions exist.
- `tempo` — first back minute and gold, item completion timestamps vs the enemy mid. Note
  ITEM_PURCHASED has 128 rows with `participantId: 0` out of 15920 (pre-game); handle it.
- `roams` — per-minute position by lane zone, and what happened to his own wave meanwhile.

**M3 — DONE 2026-08-18.** `src/cli.ts` dispatches cerrar · report · prep · cobertura · growth ·
page · hip · rank over the analysis layer, which was already pure and stayed where it is —
`src/lib/` was never needed, `src/analysis/` already is that library. The ritual scripts are
retired; `scripts/` keeps smoke, call, register-hypotheses and export-matchup-record. The
headline deliverable (3 expensive moments with the exact minute) ships inside `lol cerrar`.

**M4 — account handling + season growth curve + matchups** (HARD REQUIREMENT before the
main's first ranked game)
- Machine-checked guardrail, REVISED: a statistic spanning more than one `puuid` must emit
  the per-account breakdown; the test fails if it returns only the merged aggregate. The
  earlier "may not span two puuid at all" is wrong and was overruled — see §5.
- ~~**Season growth curve**: game by game across both accounts~~ — **STALE, and it contradicts
  §5b, which is the settled version.** §5b withdrew the merged cross-account curve after Marcos
  accepted the elo confound: growth tracking stays, but PER ACCOUNT. This bullet survived from
  before that and would have been inherited as a deliverable. Fixed 2026-08-16; do not
  resurrect the merged curve without raising the confound again.
- ~~Matchups: own history + op.gg meta prior + shrinkage proportional to n.~~ **DONE
  2026-08-16** — `src/analysis/prep.ts`. Shrinkage weight swept per G-011, own record scoped to
  one account, reps pooled, `confidenceOf` says what the n does and does not allow.
- ~~`lol prep <enemy champ>`.~~ **DONE** — `scripts/prep.ts`.
- ~~Machine-checked cross-account guardrail~~ **DONE** — `MATCHUP_PERSPECTIVE` + `pool()` in
  `src/analysis/matchups.ts`, pinned in `tests/prep.test.ts`.
- ~~STILL OPEN in M4: per-account growth tracking~~ **DONE 2026-08-16** —
  `src/analysis/growth.ts` + `scripts/growth.ts`. Cannot span accounts by construction (takes
  one puuid). Refuses a non-causal metric (G-008). ADR-012 records why the underlay is the
  opponent's absolute level rather than rank: **match-v5 carries no rank/tier/LP/MMR on any of
  its 156 participant keys**, verified, so §5b's "draw rank underneath" is not buildable
  retroactively at all.
- **M4 is closed except for one thing Marcos may want**: league-v4 is already wired
  (`getLeagueEntriesByPuuid`) but nothing snapshots it. A rank series can only start from the
  day we begin recording, so every day without it is a day of curve that can never be
  annotated with a real division — the same shape as athlete-os's 56-day clock. Cheap: one
  table, one call per sync.

**M5 — daily export to athlete-os** — **ON HOLD 2026-08-16, Marcos's call.** athlete-os itself
is paused until his WHOOP arrives, so the 56-day clock has nothing to count against: the export
would be feeding a system with no life data on the other side. Do NOT build anything that
touches athlete-os until he says the WHOOP is in. **Fase 4 (life vs performance) is blocked by
the same thing** — it was only ever the athlete-os pattern engine reading LoL metric_keys.
*(Original scope, for when it unblocks: 4-6 metric_keys through the existing
`import_observations` RPC. The unlock is 56 CALENDAR days, so the clock starts when the export
starts and every day of delay is a day added to the end — which is why this was pulled forward
in the first place, and why it should restart promptly once the WHOOP lands.)*

**Fase 3+** — hypothesis ledger (partially pulled forward, §1), metric lifecycle, coverage
tracker, `lol review`, vault writes. Then Fase 4 (life data, needs ~56 days). Fase 5 (a local
page for the gold curve and death map) only if Marcos asks.

---

## 3. Needs Marcos in the room

1. ~~**Diana.**~~ **ASKED AND ANSWERED 2026-08-18.** Put to him with the real numbers (0/5 from
   even-or-behind, all 6 wins from already being ahead, against Locke's 3/7 in those states).
   His call: **decide with data, not now.** Which needs nothing built — `diana_needs_a_lead` is
   already registered at n=5 of 25. The honest caveat, recorded: he has not played her in 8
   games, so it may never reach n, and "his behaviour already answered" stays the likely
   outcome. Do not re-litigate this without new games.
2. ~~**Day 1 of the main.**~~ **THE BEFORE-THE-GAME HALF IS BUILT, 2026-08-19 (ADR-022).**
   `lol antes` / `lol_antes` / the panel's "Antes de jugar": the runway (what will break
   tonight's ritual), AT MOST ONE hypothesis from the ledger, the clock, and what it still
   cannot speak about. The interesting part is what it refuses — a row whose verdict is within
   reach is withheld, because showing it burns the only clean window it will ever have, and
   whatever IS shown is recorded in `briefing_exposures` so a later verdict carries its
   asterisk. What remains for HIM, and only once the main is really running: whether the one
   focus is the right shape, or whether the pre-game moment wants something the ledger cannot
   give (a matchup, a mood, a "no juegues hoy"). Do not guess it — ask after he has used it.
   Note G-019 was born from precisely the main's day-1 state: no record and no prior.
3. ~~**The op.gg cross-check from S1 step 4 was never confirmed to have run.**~~ **DONE
   2026-08-16, and it PASSES.** All 8 champion totals reconcile exactly against
   `opgg-champion-pool-2026-08-14.csv`, and all 20 games in `opgg-matches-2026-08-14.csv` match
   the cache. Three alignments were required and each is worth keeping: (a) op.gg timestamps
   the game END, the cache stores `gameCreation`, so a naive time join scores 0/20 on games
   that are identical — the offsets are the durations; (b) op.gg excludes remakes, the cache
   keeps them (Diana had 2 one-minute remakes, Senna 1, and Senna's counted as a WIN, which is
   exactly the kind of row that inflates a rate); (c) the cache was missing 6 flex games, now
   backfilled — smurf ranked history is complete at 69 (51 soloq + 18 flex).
4. ~~**The vault write path is undesigned.**~~ **SETTLED 2026-08-18 (ADR-017): there is no write
   path.** The engine writes CSV to `_raw/lol/` and never markdown. Honouring vault rule 2 from
   outside the vault would mean designing a merge policy, a touchable-key set and a conflict
   surface — all to automate a paste. Refusing the write makes the rule unbreakable instead of
   enforced.
5. **The rename** `riot-mcp` -> `lol-lab`, deferred deliberately. End of week, one line in
   `~/.claude.json`, done when nothing is mid-flight.
6. **The personal API key** still has not arrived. The dev key expires every 24h, which is
   fine for interactive work but makes a nightly automated export fragile. Decide whether the
   export tolerates a stale key (queue and retry) or simply skips a day.

---

## 4. Where the last session may have been WRONG — challenge these

Written deliberately so the next session argues with its predecessor instead of inheriting
its conclusions.

1. ~~**The 14-minute choice got the scrutiny the gold band got, and then didn't.**~~
   **RESOLVED 2026-08-16 S4 — the sweep was run and the finding FAILED it.** Full result in
   §0/A1: the gap is negative at 14 and positive at 12 and 16. This entry was right to exist
   and right to be suspicious; the next session should not re-run it, it should build the
   sweep into the report so no future finding can skip it.

2. **Binary win/loss wastes information at n=20.** "Conversion" is currently a coin flip per
   game. A continuous outcome — Δgold over the 6 minutes after the state, or gold diff at 20
   given the state at 14 — would extract far more signal from the same games and would let
   effect sizes replace proportions. Strongly consider switching the outcome variable before
   building reports on top of the binary one.

3. **One confound was NOT ruled out: opponent quality.** The 10 games where he is behind are
   games where the enemy mid beat him, who may simply be better players and convert better
   for that reason alone. Lead magnitude was checked (and runs the other way), champion mix
   was looked at, opponent skill was not. There is no rank data cached per opponent; league-v4
   per opponent would cost requests. Decide whether it is worth it, or accept the caveat
   loudly.

4. **Two contamination classifications are genuinely arguable and were decided quickly.**
   - `max_cs_adv_on_lane` was called contaminated because it is a whole-game maximum — but
     the maximum is usually reached during laning, which would make it causal.
   - `turret_plates` was called causal because plates stop existing at 14 — temporally true,
     but plates are substantially a CONSEQUENCE of already winning lane.
   The class is defined as "measurable before the outcome is decided", which is temporal, not
   exogeneity. If that definition is the wrong one, fix the definition, not the labels.

5. ~~**`conversionIsRobust` ... is strict enough to be brittle.**~~ **WRONG DIRECTION, and the
   real defect is the opposite — see §0/A4.** On the real data it returns `true`, and it also
   returns `true` for a gap of exactly zero. It is too LENIENT, not too strict. Fix under R7:
   the test must assert consistent sign AND non-zero, which covers more than it does today.

6. **The three-layer split assumes athlete-os only ever needs 4-6 numbers a day.** That is
   the load-bearing assumption of ADR-006. If a pattern candidate ever needs per-match LoL
   data, the seam is wrong and the ADR should be revisited rather than worked around.

7. ~~Nothing from Fase 0 is committed.~~ **DONE** — `28c67fa`, merged fast-forward to
   `master` (now `8a0018d`), verify green, working tree clean. The merged branch
   `feat/phase-0-timelines-contamination` still exists pointing at the same commit and can be
   deleted whenever. STILL OPEN: there is no git remote, so nothing is backed up off this
   machine — worth creating the GitHub repo the way athlete-os has one (ADR-021 there).
   *(This entry originally said "one commit (684c9e3)", inherited from state.md's S1 log
   without running `git log` — the repo had three. Kept visible rather than quietly fixed: it
   is a small live instance of exactly the error class §4.3 and the session prompt warn
   about, and it happened while writing the warning.)*

8. **The out-of-sample framing in §1 was overstated twice and is corrected here.** (a) The
   window is not "clean": the finding was reported to Marcos in conversation, so if he starts
   playing leads more carefully, next week's games mix "the pattern was real" with "he was
   told and reacted", and those cannot be separated afterwards. Record that caveat ON the
   hypothesis rather than calling the window blind. (b) It is not "the only window that will
   ever exist" — it is the last one COMPARABLE TO THESE 36. The main will generate its own
   out-of-sample data; that data just tests a different population, not this hypothesis.
   Also be realistic about size: ~8-15 games in a week, maybe 5-8 of them starting ahead at
   14. That is not a verdict. What registering now buys is an honest clock, not an answer.

---

## 5b. FINAL cross-account rule (2026-08-16, third and settled version)

§5 below records how this moved; THIS is the rule to build. Marcos landed it himself after
hearing the elo argument, and it is sharper than either earlier version:

> **Knowledge pools across accounts. Performance does not.**

- **Pools** (elo-invariant): rep count per matchup, what the opponent does and WHEN, the combo
  that kills him, builds/runes that worked, the minute the matchup turns. How Akali plays
  against Locke is the same fact in Iron and in Challenger.
- **Never pools** (moves with opponent quality): win rate, gold/CS/XP differentials,
  conversion rates, anything peer-relative. Always split by account.
- **Tie-breaker when unsure**: if it is a number produced by how a game WENT, it is
  performance and it splits. If it is a fact about how the matchup WORKS, it is knowledge and
  it pools.

Implement with the same shape as `Metric.contamination`, which already exists and works:
tag every matchup field `conocimiento | rendimiento`, have the merge path refuse to pool a
`rendimiento` field across accounts, and pin it with a test. Classify-enforce-test is now the
house pattern for this class of problem; it is also one of the generalizable ideas worth
carrying to other projects.

**The season growth curve as a cross-account PERFORMANCE comparison is withdrawn** — Marcos
accepted the elo confound ("no compares la main con la smurf"). Growth tracking stays, but
per account. Do not resurrect the merged curve without raising the confound again.

**RESOLVED (was blocking M4):** the "main la estoy usando para practicar" line WAS a slip for
"smurf". The main is ladder-serious from game 1, so M4 measures consistency and LP on it from
the first ranked game.

**NEW, affects the vault before main data arrives:** `30-lol/matchups/*` carries `partidas`
and `wins` with no account dimension. Those are performance and will silently merge Plat-2
smurf games with a fresh-MMR main climb. Vault rule 10 already solves the identical problem
for flex (`partidas_flex`/`wins_flex`, never summed, because mixed-division win rates mean
nothing) — the same treatment is needed per account. Vault schema changes are delegated
(vault CLAUDE.md "Evolución del schema") but require a commit of their own, a line in
`90-meta/schema-changelog.md`, migration of existing notes in the same commit, and telling
Marcos. Do this BEFORE the first main game is recorded.

---

## 5. How the cross-account rule moved (history — see §5b for what to build)

The plan shipped with "every query is account-scoped, no cross-account aggregate ever,
machine-checked". Marcos overruled it: he wants to see his season game by game across BOTH
accounts, because he is the same player and wants to watch himself grow. He is right, and the
original rule was too blunt — it banned the VIEW when the thing that actually breaks is the
MERGED NUMBER. Revised rule is in plan §3 and state.md.

What the next session must carry into the design:

- **No growth metric is elo-invariant, and the curve must say so.** Absolute stats rise
  against weaker opponents with no improvement. The peer-relative gap — which looked like the
  escape hatch, and which the plan originally sold as the legitimate cross-account statement
  — has the same flaw plus an inverse one: as the main climbs, opponents get better and the
  gap SHRINKS while he is genuinely improving. Real progress and MMR movement come mixed and
  cannot be separated from this data. The mitigation is presentational: draw rank/MMR
  underneath the metric so a jump can be attributed. Marked that way the curve is honest;
  unmarked it misleads.
- **The hypothesis ledger stores account and elo per evaluation.** A hypothesis confirmed on
  the smurf and failing on the main is NOT a contradiction — it is evidence the pattern is
  level-dependent. The old rule would have filed it as noise.

**OPEN, blocking part of M4's design:** Marcos wrote "la **main** la estoy usando para
practicar y llegar a un buen nivel antes de arrancar con la main". Almost certainly a slip for
"la smurf" — it matches everything else he has said. But if it is NOT a slip and he intends to
use the main itself for practice before climbing seriously, then the main's first games are
not ladder-serious and M4 must not measure them as consistency/LP from game 1. ASK before
building M4.
