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
(ADR-006). Three of them, no duplicated arithmetic: `src/server.ts` (MCP, 15 tools), `src/cli.ts`
(`lol antes · cerrar · report · prep · cobertura · growth · page · hip · rank · items · assets ·
ui`) and `src/ui/*` (the local panel, ADR-018). Composition that all three need and that cannot
be pure lives beside them: `src/sync.ts` and now `src/pregame.ts`.

Analysis modules: `state`/`conversion` (lane state at a minute, `restOfTeamGoldDiff` with his own
lane pair removed) · `events`/`moments` (deaths, fights, expensive moments) · `curve` (state
curve, `biggestSwing`, `phaseSplit`) · `macro` (objectives, vision timing, tempo, roams) ·
`matchups` + `prep` (own record, pooled reps, op.gg prior, shrinkage, `confidenceOf`) ·
`growth` (per-account curve vs the lane opponent, `drift` and `trendSlope`) · `hypotheses` +
`measures` (the ledger, one measure dispatching on a frozen spec) · `capture` (play sessions and
reported tags) · `coverage` · `rank` · `render` (SVG + its CSS) · `names` · `priors` · `metrics`
(every metric declares `contamination`) · `items` (build timings against the lane opponent) ·
`briefing` (what may be said BEFORE a game, ADR-022).

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

### S8e — item timings, the M2 cut that came back

`ITEM_PURCHASED` carries an itemId and nothing else, which is why M2 cut build timings. Data
Dragon closes it: no key, no rate limiter (different host — every request spent there is a match
not downloaded), immutable per version. ADR-020.

- `src/riot/ddragon.ts` (fetch + the pure `itemsFromJson` filter) · `items` table keyed by
  (item_id, VERSION) · `src/store/items.ts` (`catalogForPatch` joins by `major.minor` prefix) ·
  `src/analysis/items.ts` (`completionsOf`, `itemRace`) · `lol items` · wired into `lol report`
  and into the panel's game cards.
- **Eight catalogues cached**, one per patch he has actually played (14.24 to 16.16). A patch
  with no catalogue says so instead of borrowing another patch's build paths.
- `ITEM_UNDO` is real (ten in the first timeline inspected) and is honoured, or an undone
  purchase dates the build early.
- **The first reading was a trap and the aggregate caught it.** Over his last six games his first
  item lands +3.12 min after his opponent's, which looks like a finding. Over all 42 it is
  **+0.34 min**, and conditioned on the lane state at minute 10 it is −1.79 ahead, +1.69 even,
  +5.04 behind: the metric is bought with gold. It is reported beside the gold curve for that
  reason and never alone. The one shape worth watching, and NOT registered at n=10: **+1.69 min
  late from an EVEN lane at 10**.
- Knob swept: the 2200-gold floor gives the same answer at 2000 and 2500 and flips at 2800
  (−0.83, n=37), so the floor is stated in the module and the sweep is on the record here.

verify green, 285 tests.

### S8f — el panel con imágenes

Pedido suyo: que se entienda de un vistazo. ADR-021.

- `lol assets` baja una vez el arte de Data Dragon a `data/img/` (gitignoreado): 163 campeones,
  240 ítems y el minimapa, 5.9 MB. Se sirve desde el servidor local, **nunca hotlinkeado** — la
  página promete que nada sale de la máquina y un `<img>` a la CDN lo rompía en cada carga.
- Retratos de campeón en cada tarjeta (anillo verde/rojo según resultado) y en las tarjetas de
  tagueo, que es donde más ayuda: se reconoce la partida por la cara antes que por la hora.
- La build ahora son íconos de ítem con el minuto debajo, en dos filas (vos / rival).
- **El mapa de muertes tiene el minimapa real de fondo**, con un velo para que los puntos sigan
  siendo lo más brillante, puntos con contorno para que no se fusionen y la diagonal
  base-a-base retirada porque la foto ya dibuja mid mejor que una línea punteada.
- Los archivos se guardan con el nombre que usa el MATCH, no el de Data Dragon: así la página
  arma la URL con lo que ya tiene, y el caso `FiddleSticks`/`Fiddlesticks` (G-016) se resuelve
  al bajar en vez de fallar como imagen rota.
- `/img/*` se sirve ANTES del token: es arte público de Riot, no dice nada de él, y así el SVG
  memoizado del mapa sobrevive a un reinicio. El path traversal se cierra con `safeAssetName`
  más tres carpetas fijas, con test.
- Sin librerías: la legibilidad vino del arte, no de un renderer (ADR-003 sigue en pie).

verify verde, 289 tests. Visto en el navegador, no supuesto.

## S9 2026-08-19, CLOUD — the other half of the ritual

Code-only session (D1: nube = código, local = datos), so nothing below was run against the real
cache. `pnpm verify` green here on Node 22.22, 309 tests.

**Roadmap §3.2 is closed: there is a pre-game moment now.** `lol antes`, `lol_antes` and a panel
section, over `src/analysis/briefing.ts` (pure) and `src/pregame.ts` (the composition + the one
write). ADR-022.

- **The design decision is a refusal.** Showing him a live hypothesis before a game contaminates
  it on purpose — §4.8 already recorded that — so the briefing shows AT MOST ONE, and only a row
  whose verdict is out of reach. On today's ledger that means `ward_before_objective_60s` (931
  short) is spendable and `diana_needs_a_lead` (20 short) is WITHHELD, with the panel saying so:
  the silence is a decision, not a hole.
- **The horizon knob was swept and the first claim about it was FALSE.** The comment said the
  partition is stable from 100 to 400; the test proved it changes at 270, where
  `lead_conversion_gap` flips to withheld. 200 sits inside the real insensitive range (100-269).
  Both the comment and the test now say the true bound, and the boundary is pinned.
- **`briefing_exposures`** (append-only, deduped to one row per sitting) turns the contamination
  into a number: `lol hip` and `lol_hypotheses` now print `EXPUESTA desde <fecha> · N sentada(s) ·
  M partida(s) jugadas sabiéndola` on any row he has been shown. There is deliberately no flag to
  preview without recording.
- **G-029 born from running it.** A hypothesis that had never been evaluated arrived as `n = 0`,
  so its shortfall was the whole of `nNeeded` and it looked FURTHER from a verdict than any
  evaluated row — making an unevaluated ledger maximally talkative, exactly backwards, and the
  exposure it spends cannot be undone. `n` is `number | null` now; a null is withheld with its own
  reason and the briefing says to run `lol hip evaluar` first. The tests were green before this
  was found; `lol antes` against a seeded cache is what found it.
- **One implementation of "what is broken", not two.** The panel's `acciones` and the briefing's
  runway are the same list under two framings, so `estado()` now delegates to the pure `runway()`.
  Behaviour is unchanged and the 43 UI tests passed untouched.
- The panel's old "Antes de entrar" (the matchup lookup) is now **"En champ select"**, so the two
  pre-game moments read as different things: the session briefing and the per-game matchup.
- Seen in a browser, not assumed: served, screenshotted and read.

### What is NOT built, deliberately
- The briefing never invents advice. Everything it can say comes from the ledger, so if the
  ledger is empty it says exactly that.
- `lol antes` has no `--sin-anotar`. A register that can be bypassed is a register that lies at
  the exact moment it has to be believed.

### S9b — el panel hace las tareas, y ya no hay que correr nada

Su pedido, textual: *"yo no quiero correr nada, yo quiero que la ui tenga botones y haga las cosas
sola"*. Tenía razón y era un defecto de diseño, no una preferencia: tres de los cuatro comandos
que quedaban eran cosas que hay que ACORDARSE de correr, y cada olvido tiene un costo real —
sin catálogo no hay tiempos de ítem, sin imágenes el panel es texto, y sin evaluar el ledger el
briefing de S9 no puede mostrar nada (G-029). ADR-023 y ADR-024.

- **`src/upkeep.ts`**: catálogos de ítems, imágenes y evaluación del ledger, en una sola
  implementación. `lol items` y `lol assets` se reescribieron encima de ella, así que ya no hay
  dos versiones de "qué falta". Cada tarea es idempotente y calcula el faltante con una consulta
  LOCAL, que es lo que hace que se puedan correr siempre.
- **El botón de sincronizar corre la cadena entera** — partidas → rango → catálogos → imágenes →
  ledger (esto último solo si entraron partidas, porque sin evidencia nueva una evaluación es una
  fila idéntica). Pueden ser automáticas porque **ninguna gasta un request de Riot**: Data Dragon
  es otro host y sin key, y evaluar es aritmética local. El sync de partidas, que sí gasta, sigue
  siendo un botón que él aprieta.
- **Sección "Puesta al día"** con lo que falta y un botón por tarea, para cuando falta algo y no
  viene de sincronizar. Y las acciones de "Qué hacer ahora" ahora EJECUTAN: sincronizar, ir a
  taguear, pegar la key.
- **La key se pega en el panel** (ADR-024). Era la fricción más frecuente que existe —vence cada
  24 h— y el último paso que lo sacaba del panel. Cierra además el incidente de S8b: la pegó en
  `.env.example`, que está trackeado y va a un repo público. Va por POST y nunca por query string,
  el input es password y se limpia al guardar, la respuesta no trae el valor (G-002) y lo que no
  empieza con `RGAPI-` se rechaza ANTES de tocar el archivo.
- **G-030, dos veces en una sesión.** `writeKey` escribía al `.env` del proyecto: el primer test
  le habría borrado su key REAL en cada `pnpm verify`, en silencio, y se habría enterado como un
  401. Y `upkeepState` contaba PNGs en el `data/img` real, así que su test pasaba en una máquina
  sin arte bajado y fallaba en una con arte — falló acá en el momento en que corrí la descarga,
  que es como se encontró. Las dos toman la ruta por parámetro ahora, con la forma de `openDb`.
- Bajado y visto de verdad contra Data Dragon: 1 catálogo, 244 imágenes, 2,1 MB, y la segunda
  corrida dice "0 nuevas, 244 ya estaban".
- `lol items --todo` (forzar rebajada) se perdió en la reescritura. No estaba documentado en
  ningún lado y Data Dragon es inmutable por versión, así que solo servía si un catálogo se
  hubiera guardado corrupto.

verify verde, 320 tests.

### S9c — el panel se lee, no se opera

Pedido suyo: entrar, mirar diez minutos y salir sabiendo qué está fallando, qué no repetir y
también qué está haciendo bien, con más imágenes. ADR-025 y ADR-026.

- **"Cómo venís" arriba de todo**: rango, récord de las últimas 12, qué hace mejor y peor contra
  su rival de línea, un gráfico de barras divergentes, y sus campeones con foto y su récord. Lo
  operativo (sincronizar, taguear, puesta al día, key) quedó agrupado abajo bajo encabezados.
- **La lectura es `benchmark()`, que ya existía y NUNCA había estado en pantalla.** Compara contra
  los otros nueve jugadores de sus propias partidas, que para una métrica de rol es exactamente su
  rival de línea (ADR-002).
- **Lo que se niega a mostrar es el punto.** Una métrica contaminada puede dibujarse pero no puede
  encabezar (G-008), así que las 14 que quedan afuera se CUENTAN en pantalla. Y el titular se lee
  de la `severity` que el motor ya calcula, no de "el primero de la lista" (G-032).
- **`metricBarsSvg`**, el gráfico nuevo, en `analysis/render.ts` como todos los demás. El par de
  colores se eligió CORRIENDO el validador, no a ojo: verde/rojo mide ΔE 7.9 bajo deuteranopía
  contra 26.8 del azul/naranja. La posición ya codifica el signo, así que el color es redundante y
  el gráfico se lee igual sin distinguir los colores. El largo es el tamaño del efecto, recortado
  en ±1.5, porque una diferencia de 8 de CS y una de 0.3 de participación no comparten escala.
- G-031: `pnpm verify` empezó a fallar sin decir por qué — el único error real estaba tapado por
  los ~110 infos de `useLiteralKeys` ("Diagnostics not shown: 94"). El script usa
  `--diagnostic-level=warn` ahora, y encontrarlo costó un bisect contra HEAD limpio.
- Visto en el navegador dos veces: la primera versión cortaba la etiqueta larga
  ("*ntaja* de oro+XP en fase de líneas"), que sin mirarlo no se veía.

verify verde, 329 tests.

### S9d — las fases, dibujadas

`phaseAverages` (puro, en `curve.ts`) + `phaseBarsSvg`, en la lectura. ADR-027.

- **Cada fase tiene su propio n**: una partida de 22 minutos aporta a línea y a medio y NO al
  cierre. Contarla como un cierre de cero minutos hundiría el promedio de una fase que esa
  partida nunca jugó.
- **Las tasas se ponderan por MINUTO jugado, no por partida**: un cierre de 2 minutos y uno de 20
  no pueden pesar igual, o un puñado de segundos mueve la fase entera.
- **Las dos puntas se comparan sobre las MISMAS partidas.** Si en algunas no hay rival de línea
  medible, su promedio y el del rival saldrían de muestras distintas (G-015); la diferencia se
  calcula solo sobre las partidas donde los dos existen, y su promedio general se reporta aparte.
- Un rival ausente NO es un rival que farmeó cero (G-005).
- **La leyenda dice que después del 14 esto no se lee como habilidad.** Todo `phaseSplit` está
  contaminado en el sentido de G-008 — el que va ganando rota y farmea menos — así que una
  ventaja que se achica puede ser exactamente lo que hace bien. Por eso el número del rival va
  al lado del suyo y la diferencia nunca viaja sola.
- Builder aparte y no un parámetro de escala en `metricBarsSvg`: aquellas barras son tamaños de
  efecto y estas son CS/min de verdad. Una misma longitud con dos unidades atrás es cómo un
  gráfico miente sin decir nada falso.
- Visto en el navegador: la barra más larga del gráfico de métricas terminaba PEGADA al número.

verify verde, 334 tests.

### Lo que la lectura TODAVÍA no muestra, y por qué
- **El reparto por tag** ("cuando decís que la produjiste vos, ¿cuánto perdés?") es la respuesta
  más directa a "qué patrón no repetir", y hoy mostraría cero: el backlog se cerró por decisión
  (ADR-019) y el tagueo arranca con la próxima partida. Vale la pena recién con unas semanas.

## Open questions
- **Diana**: closed by D3 as "the ledger decides", with the caveat that at n=5 needing 25, and 8
  games since he last played her, it may never reach n.
- Still believed on trust, never verified: ADR-008's ward-position claim (the basis of a
  permanent scope cut), the "+500-1500 small leads 4/8 vs 5/7" line, the individual
  `contamination` labels.
- `data/` is gitignored and single-machine, and a cloud session cannot check a single number. A
  derived, versionable export is the cheap fix; whether it gets committed is his call.
- `git config user.name` is unset ON HIS MACHINE, so his commits are authored by `unknown`.
- **Nothing from S9/S9b has run on the real cache.** The upkeep chain was exercised against live
  Data Dragon here (a real catalogue and 244 real images), but never against HIS 86 matches.
- **The briefing has never run on the real cache.** Everything in S9 was measured against fixtures
  and a seeded database; the first real run is his, and the first thing to check is whether the
  row it picks is the one a human would have picked.
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
