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
  ADR-010, G-011..014. verify green, 59 -> 88 tests. (Committed since; see the 2026-08-18 log.)

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

M4 mostly BUILT (2026-08-16), committed in `688c21c`/`53d0656`:
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

**athlete-os is PAUSED** until his WHOOP arrives (2026-08-16). M5 and Fase 4 are off the table
until he says otherwise — build nothing that touches athlete-os. Roadmap updated.

Ledger extended to hold more than one SHAPE of question. `canonicalSpec` used to walk a fixed
global key list, which quietly made the spec schema immutable: adding a field for a new kind of
hypothesis would have rewritten the hash of every hypothesis already registered and left them
permanently unevaluatable. It now hashes each spec's own sorted keys — verified the three
existing hashes are byte-identical after the change, and pinned the algorithm by test.

Registered `ward_before_objective_60s`: among epic monsters he was NOT credited on, his team
takes 57.8% of the ones he warded for in the previous 60s against 50.7% of the ones he did not
(+7.1 points, n=64 vs 223). First hypothesis here with an n worth having — it accrues ~9
objectives per game instead of half a lane state. Window swept per G-011: +0.124 at 30s, +0.082
at 60s, ~0 at 90s and 120s, a decay coherent with the mechanism rather than the sign-flipping of
the conversion finding. The presence confound is stated on the row and not solved.

That registration exercised the retire path for real: the first attempt stored gap_games=0,
because `countGapGames` sent a vision spec down the lane-state path where `spec.champion` is
undefined and matches no row. Retired with the reason, fixed, re-registered as `_60s` with
gap=3. `tsc` HAD flagged it — Node strips types without checking them, so the script ran anyway.
Run verify BEFORE running a script, not after.

SESSION 2026-08-18 (S5) — planning, then five milestones. Everything below is COMMITTED and
`pnpm verify` is green at 217 tests (182 at session start), `pnpm smoke` green at 14 tools.

**This session ran in a CLOUD container, not on his machine.** No `data/riot.db` (gitignored), no
`.env`, no vault, no athlete-os. So: code and tests here, numbers on his machine. That split is
DECIDED (D1) and every claim below was verified against tests or a seeded cache, never against
his real games — nothing here has been run against the 69 real ones yet.

Four decisions taken with him before building:
- **D1** nube = código, local = datos. No number enters `.agent/` without the query having run.
- **D2** ONE ritual, `lol cerrar`. He asked to build `lol review` and then chose the post-session
  moment as the only moment he wants to be spoken to, so the review's content lives inside the
  ritual and appears only when it has something to say. ADR-016.
- **D3** Diana is decided by data, not now — which needs nothing built: `diana_needs_a_lead` is
  already registered (n=5, needs 25). The real risk is that he has not played her in 8 games and
  it may never reach n. Roadmap §3.1 can be closed on that basis.
- **D4** the engine never writes markdown to the vault, only CSV to `_raw/lol/`. ADR-017, and it
  closes roadmap §3.4.
- **D5** athlete-os stays frozen: neither the WHOOP nor the personal key has arrived.

**M6 — CAPTURE, at last.** ADR-007 decided it on 2026-08-16 and it had never been built: no
table, no code, no mention anywhere. `play_sessions` + `game_tags`, `src/analysis/capture.ts`.
The tag is REPORTED and fenced off structurally (ADR-015): `TAG_PROVENANCE` classifies every
field, `peerComparable` throws on a reported one, and `splitByTag` has no peer counterpart —
same shape as `pool()` refusing a cross-account win rate. Lag is measured against the game's END.
Untagged games are counted, never folded in.

**M8 — COVERAGE.** `src/analysis/coverage.ts`. `gamesToNext` is found by re-running the real
`prepMatchup` at n+1, n+2… and asking `confidenceOf`, so moving the rungs moves this. Every
result carries its scope (G-015). Reps pool, the record does not.

**M9 — A3 SETTLED.** `LaneState.restOfTeamGoldDiff` removes his own lane pair from the team
figure (r = 0.65 with `laneGoldDiff` was the problem). Added, not substituted. Two new ledger
shapes it unblocked, `TeamStateSpec` and `GrowthSpec`, both freezing their arbitrary knobs —
the growth one freezes the ROLLING WINDOW, since a rolling mean is endpoint-sensitive. Widening
the `Spec` union made `tsc` flag every site that assumed two shapes, including `countGapGames`.
The pinned lane hash is unchanged and now asserted in two files.

**M7 — CLI + THE RITUAL.** `src/cli.ts` with cerrar · report · prep · cobertura · growth · page ·
hip · rank. The ritual scripts are retired; `scripts/` keeps smoke, call, register-hypotheses and
export-matchup-record. `lol cerrar` syncs, captures (committing each tag as it is typed), prints
the expensive moments of the new games, then says what changed — and stays silent when nothing
did.

**M10 — MCP.** Six `lol_*` tools so the conversational side can finally see the engine. Read
by default; `lol_hypotheses` needs `evaluate: true` to append, and `lol_tag` reports the lag it
just recorded.

FOUR DEFECTS FOUND BY RUNNING THINGS, none of them findable by reading:
1. **`confidenceOf` said `mayormente_propio` for ONE game whenever no op.gg prior existed** —
   with no prior there is nothing to blend with, so `ownWeight` is 1 at any n and the ladder read
   the rung off that share. That is the n=1 number wearing a confident label the ladder exists to
   prevent, and **it is the state the MAIN starts in**. New rung `poco_propio`, ranked below
   `mayormente_meta`. G-019.
2. **`pnpm smoke` asserted `tools.length !== 7`** and had been wrong since the 8th tool. Now
   asserts NAMES. G-020.
3. **A readline interface per prompt**: the first buffered all of stdin, the second saw EOF, so a
   four-game session read one tag and died.
4. **G-018 fired twice**, and the second time hid a behavioural bug: the Ctrl-C check went in as a
   raw ETX byte, collapsed to an empty string, and could never fire. (The first was a raw NUL in
   `coverage.ts` — the identical defect `ce2d34c` fixed in `matchups.ts`.)

Also verified rather than assumed: cutting stdin mid-ritual leaves every tag typed so far in the
database and the session row honestly open (`closed_at` and `tilt` NULL).

NOT DONE, and it is the first thing next session: **none of this has touched his real cache.**
`lol cerrar`, `lol cobertura` and the two new hypotheses need to be run on his machine, and
`team_state_dominates` / `growth_drift` still need REGISTERING — the code is there, the
registration is a dated act that has to happen where the games are.

SESSION 2026-08-18 (S6, misma jornada) — **`lol ui`**. Marcos pidió *"una UI que ejecute las
cosas sola, o de última que me diga qué tengo que ejecutar"*, lo que revisa ADR-001, ADR-007 y
ADR-014 de una sola vez. Es su llamada y la revisión es legítima por un motivo concreto: **la
página estática no puede actuar** — se abre con `file://`, así que no sincroniza, no le pega a la
API y no escribe en SQLite. ADR-018 registra la decisión entera.

Tres decisiones más (D6/D7/D8): un servidor local con `lol ui`, la UI ejecuta todo, y nada corre
en segundo plano si él no abrió la página.

Construido, `src/ui/` como TERCER front-end sobre `src/analysis/*`, que no se tocó:
- **M11** servidor `node:http` en 127.0.0.1 + panel "qué hacer ahora". `/api/estado` no gasta un
  solo request, que es lo que hace seguro pollearlo.
- **M12** la captura por click: una request por partida, escrita antes de responder.
- **M13** sync por SSE con barra de progreso, mutex liberado en `finally`.
- **M14** momentos caros, curva, mapa de muertes, cobertura, ledger y prep.

Guardas: token por arranque + chequeo de `Origin` en los POST, bind a 127.0.0.1 nunca 0.0.0.0, y
la key NO viaja al navegador (pineado por FORMA, así que agregar un campo falla en vez de filtrar).

**TRES DEFECTOS QUE SOLO APARECIERON CORRIENDO LAS COSAS:**
1. **El script del cliente no compilaba, y todo estaba verde.** Vive dentro de un template
   literal, donde `\n` es un salto de línea REAL, así que una cadena escrita como `'\n'` salía
   partida en dos y el script entero era inválido. La página habría cargado sin hacer nada, con
   tsc, Biome y Vitest los tres en verde, porque ninguno mira adentro de un string. **G-022**, y
   ahora un test lo compila con `new Function`.
2. **`spawn` falla de forma asíncrona**, así que el try/catch alrededor no atrapaba nada y la UI
   entera se moría en una máquina sin `xdg-open` — después de haber impreso su URL. **G-021**.
3. "Nunca sincronizado" y "sincronizado hace mucho" se estaban confundiendo: un timestamp ausente
   mapeado a 0 daba una antigüedad de quinientas mil horas.

Verificado a mano, no afirmado: **`kill -9` al servidor a mitad del tagueo deja los tags ya
clickeados en la base** y la sesión honestamente abierta (`closed_at` y `tilt` en NULL). Y el
camino que de verdad va a pasar —sync con la key vencida— emite el error por el stream, devuelve
el botón y deja la UI viva.

verify verde, 217 → 248 tests. `pnpm smoke` verde con 14 tools.

SESSION 2026-08-18 (S7) — **la UI vista y endurecida para su máquina.** Marcos dijo estar en su
PC y pidió levantarla. **Esta sesión sigue en el contenedor de la nube** — verificado, no supuesto
— así que no se puede: un servidor acá escucha en el 127.0.0.1 del contenedor. Lo que sí se hizo
fue abrirla con el Chromium headless que ya está instalado y mandarle capturas.

Sembrar 70 partidas con timelines completos (6.4 MB) en vez de 4 cambió todo: **los tres defectos
de esta tanda sólo aparecen con datos y con una pantalla.**

1. **`/api/graficos` tardaba 40 ms** con 6.4 MB de timelines, recorriendo TODAS las partidas en
   cada carga. Advertí "cientos de MB bloqueando el servidor" leyendo el código y **la medición
   dice menos que eso**: ~1,2 s extrapolado a sus timelines reales (~30x más grandes). Memoizado
   → 0 ms. La clave de invalidación incluye la cuenta de TIMELINES, porque un backfill agrega
   muertes sin cambiar ni la cantidad de partidas ni la más reciente.
2. **El mapa de muertes salía NEGRO ENTERO.** Reusé `deathMapSvg` pero no su CSS, que vivía sólo
   en el `<style>` de la página estática. Los SVG emiten clases y no traen presentación, así que
   todos los rellenos cayeron al default del navegador: 188 muertes contadas, cero dibujadas, con
   tsc, Biome y Vitest en verde. **G-023**, y ahora un test deriva las clases de un dibujo real y
   exige que cada una tenga regla en las DOS superficies.
3. **La lista de tagueo era un muro de 70 tarjetas.** Partida en "de la sesión" (12 h) y "atrasadas"
   plegadas — por layout, pero sobre todo porque taguear algo de hace dos semanas es memoria y no
   observación, que es justo lo que ADR-015 separó.

Además, para que la primera corrida en Windows no choque contra algo que no puedo probar:
fallback de puerto 4477→4485 (verificado peleando dos servidores por el mismo puerto), la URL
citada para `cmd /c start`, preflight que avisa y no bloquea, y `lol-ui.bat` con `pause` ante
error para que el mensaje no desaparezca. `.gitattributes` le da CRLF al `.bat`.

verify verde, 248 → 256 tests.

**PENDIENTE Y ES SUYO**: nada de esto corrió contra su caché real todavía. En su PC: `git pull`,
`pnpm install`, doble click. Lo que hay que mirar ahí y no se puede desde acá: que abra el
navegador solo, que el panel liste sus dos cuentas, **cuánto tarda la sección de curva y mapa**, y
un sync real con la barra.

Open questions:
- **Registering the two new hypotheses is pending and time-sensitive in the same way §1 was.**
  Both need their arbitrary knobs swept at registration (G-011): band and teamBand for the team
  state, the rolling window for the drift.
- **Diana**: closed by D3 as "the ledger decides", with the caveat that it may never reach n.
- Still unverified and believed on trust: ADR-008's ward-position claim (basis of a permanent
  scope cut), the "+500-1500 small leads 4/8 vs 5/7" line, the individual `contamination` labels.
- `data/` is still gitignored and single-machine, and it now costs more than it did: a cloud
  session cannot check a single number. A derived, versionable export is the cheap fix; whether
  it gets committed is his call.
- `git config user.name` is unset ON HIS MACHINE, so his commits are authored by `unknown`. The
  commits from this session are authored by Claude, which is accurate.
- `package.json` declares `engines: >=24`; the cloud container runs Node **22.22**, where
  `node:sqlite` and type-stripping both work unflagged and the whole suite passes. Left declared
  at 24 — that is the supported runtime and the README says so — but 22 is now known to work.
- One historical revision (`688c21c`) holds `matchups.ts` as a BINARY blob. Cosmetic, and
  cleaning it would mean a force-push on a public repo.
- Repo still named `riot-mcp` locally while GitHub calls it `lol-project`; rename to `lol-lab`
  still deferred (path wired into `~/.claude.json`).
- **The VAULT is a different repo and stays local** — it holds `10-salud` and `20-finanzas` and
  must never be pushed without a separate, explicit instruction.
