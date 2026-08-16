# Roadmap — what to build, and what to ARGUE ABOUT, next session

Read after `state.md`. §1 is time-critical. §2 is the build queue. §3 is the part that needs
Marcos in the room. §4 is where the last session thinks it may have been wrong — challenge it
rather than inheriting it.

---

## 1. Do this FIRST, it is time-critical

**Register the conversion finding as a formal hypothesis, dated, BEFORE more games arrive.**

The Fase 0 finding (he converts a minute-14 lead 70%, his opponents 80%) rests on n=20 and
n=10. The plan's answer to exactly this is the Fase 3 hypothesis ledger: every finding is
registered as a dated PREDICTION and evaluated ONLY against games played after that date.

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

---

## 2. Build queue

Tasks #3-#6 exist in the task list. State as of session end:

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

**M3 — pure lib + CLI + per-match report**
Extract analysis to `src/lib/` (no I/O), keep `server.ts` as the MCP front-end, add
`src/cli.ts` for the rituals. The headline deliverable: per game, the 3 most expensive
moments with exact minute, so he can open the replay at that timestamp. Replays are local
`.rofl` and break on patch change, so the report is only useful within the week.

**M4 — account handling + season growth curve + matchups** (HARD REQUIREMENT before the
main's first ranked game)
- Machine-checked guardrail, REVISED: a statistic spanning more than one `puuid` must emit
  the per-account breakdown; the test fails if it returns only the merged aggregate. The
  earlier "may not span two puuid at all" is wrong and was overruled — see §5.
- **Season growth curve**: game by game across both accounts, account boundary marked, with
  rank/MMR drawn underneath the metric. Marcos asked for this explicitly and it is a
  deliverable, not a concession.
- Matchups: own history + op.gg meta prior + shrinkage proportional to n.
- `lol prep <enemy champ>`.

**M5 — daily export to athlete-os** (build early, read late)
4-6 metric_keys through the existing `import_observations` RPC. athlete-os's pattern unlock
is 56 CALENDAR days, so the clock only starts when the export starts. Every day of delay is a
day added to the end.

**Fase 3+** — hypothesis ledger (partially pulled forward, §1), metric lifecycle, coverage
tracker, `lol review`, vault writes. Then Fase 4 (life data, needs ~56 days). Fase 5 (a local
page for the gold curve and death map) only if Marcos asks.

---

## 3. Needs Marcos in the room

1. **Diana.** 43% win rate, 39% of his games, converts a lead worst (6/9), 0/3 from behind.
   Small n, real direction. Before the main climbs: does Diana belong in the main's pool at
   all during a climb, given the main's whole point is consistency and variance-reduction?
   This is his call, not the software's — but it should be put to him with the numbers.
2. **Day 1 of the main.** What does he actually get told before and after his first ranked
   games? The peer-relative benchmark works from game 1 (needs no history), matchup priors do
   not. Needs a decided ritual, not an assumption.
3. **The op.gg cross-check from S1 step 4 was never confirmed to have run.** It is the only
   end-to-end verification that the pipeline agrees with an independent source. Cheap to
   redo against `vault/_raw/lol/opgg-matches-2026-08-14.csv`. Worth doing before more is
   built on top.
4. **The vault write path is undesigned.** Which frontmatter keys the engine may touch, and
   how vault rule 2 (contradiction is never overwritten, it is surfaced) is honoured
   mechanically. Do not write to the vault before this is agreed.
5. **The rename** `riot-mcp` -> `lol-lab`, deferred deliberately. End of week, one line in
   `~/.claude.json`, done when nothing is mid-flight.
6. **The personal API key** still has not arrived. The dev key expires every 24h, which is
   fine for interactive work but makes a nightly automated export fragile. Decide whether the
   export tolerates a stale key (queue and retry) or simply skips a day.

---

## 4. Where the last session may have been WRONG — challenge these

Written deliberately so the next session argues with its predecessor instead of inheriting
its conclusions.

1. **The 14-minute choice got the scrutiny the gold band got, and then didn't.** The band is
   swept across 300/500/750/1000 precisely because it is arbitrary — but STATE_MINUTE = 14
   was picked by reasoning and never swept at all. That is inconsistent. Sweep 10/12/14/16/20
   and check the conversion gap survives. If it only exists at 14, it is an artefact.

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

5. **`conversionIsRobust` requires every band to agree in sign, which is strict enough to be
   brittle.** With an empty bucket at one band it returns false even when the finding is
   fine. It has a test pinning that behaviour; if it proves annoying in practice, change the
   rule deliberately rather than loosening the test (R7).

6. **The three-layer split assumes athlete-os only ever needs 4-6 numbers a day.** That is
   the load-bearing assumption of ADR-006. If a pattern candidate ever needs per-match LoL
   data, the seam is wrong and the ADR should be revisited rather than worked around.

7. **Nothing from Fase 0 is committed.** The repo is at `abf96fd` (3 commits: 684c9e3 init,
   f23e9c7 docs + .gitattributes, abf96fd fixes-from-real-data) and all of Fase 0 is
   uncommitted working tree. Commit before building further, so M2 is separable.
   *(Corrected mid-session: this originally said "one commit (684c9e3)", inherited from
   state.md's S1 log without running `git log`. A small instance of exactly the error class
   §4.3 and the session prompt warn about — worth keeping visible rather than quietly fixing.)*

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
