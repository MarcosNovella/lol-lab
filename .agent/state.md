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

## S9 2026-08-20, CLOUD — la auditoría, y las siete cosas que encontró

Sesión de revisión pedida en esos términos: "chequeá que todo lo que tenemos está bien y
funcional y realmente sirve, y cuestionate todo". Todo corrido de verdad, incluida una caché
SINTÉTICA de 45 partidas con timelines para ejercitar el motor de punta a punta, que es lo que
una sesión de nube no podía hacer hasta ahora.

**Lo que estaba bien y se verificó, no se supuso:** `pnpm verify` verde (289 tests al empezar),
las 14 tools registradas, los 11 comandos de la CLI sin crashear en caché vacía, las 9 rutas del
panel respondiendo, la memoización (`/api/graficos` 46 ms → 2 ms), el guard de token y origen, el
traversal de `/img/` cerrado, `lol items` bajando 241 ítems de Data Dragon EN VIVO. Y la
afirmación más cara de S8b: busqué el shape real de una key (`RGAPI-[0-9a-f]{8}-`) en **todos**
los commits del repo — limpio. La key nunca llegó a git.

**El patrón de los siete hallazgos: una lección que quedó escrita en `.agent/` y nunca se volvió
código.** Cuatro de los siete son eso exactamente, y este repo se define por lo contrario.

- **A · G-009 era una regla y no un gate.** `early_lane_adv` y `lane_adv` leen los dos campos
  `challenges` que el propio G-009 documenta como banderas 0/1 e idénticas entre sí; los dos
  seguían `causal`, y `rankable = contamination === 'causal'`, así que el benchmark les calculaba
  Cohen's d y percentil y podían encabezar el reporte. El mismo flag pesaba dos veces. Cerrado con
  `Metric.distribution` (ADR-022) + `looksBinary`, que RE-CHEQUEA la declaración contra la muestra:
  en la primera corrida degradó una tercera métrica que nadie había marcado. G-029, G-030.
- **B · `lol growth` afirmaba progreso sobre dos curvas planas.** Con las dos derivas en cero
  todas las comparaciones dan falso y el control caía al `else`, que lee `net >= 0`: "tu línea se
  movió MÁS que la de los rivales (neto +0.000)". G-012 en un segundo lugar. `growthVerdict` es
  ahora puro, testeado, y rechaza el caso degenerado en su primera rama. G-032.
- **C · `verdictFor` traducía "no medible" a `no_effect`,** con un test que lo fijaba.
  `conversionGapBinary` devuelve NaN con n GRANDE cuando un bucket queda vacío, así que una
  muestra de un solo lado se publicaba como "no hay efecto". `unmeasurable` es ahora su propio
  veredicto, con `verdictLabel` para que las tres front-ends no lo traduzcan distinto. G-033.
- **D · Los priors de op.gg desaparecían en silencio.** Probado con archivos: CRLF → 0 priors,
  columna renombrada → 0 priors, archivo ausente → 0 priors, los tres indistinguibles y el
  tercero documentado como normal. El costo no era el meta faltante: `confidenceOf` pasaba a
  decir `mayormente_propio`, una etiqueta de confianza EQUIVOCADA. Y el CSV lo escribe un script
  Python en Windows, que es la máquina de G-010. `readPriors` + `PriorsProblem`. G-031.
  Verificado en vivo: con el CSV CRLF el prep pasó de "tu registro manda (100%)" a "(60%)".
- **E · `collectStates.skipped` se calculaba y no lo leía nadie,** bajo un comentario que promete
  que nunca se descartan en silencio. `Measurement.unreadable` lo lleva hasta la evaluación, y
  `hip`/`cerrar` lo dicen. No se persiste: describe la caché de hoy, no la evaluación.
- **F · El backfill de timelines era MCP-only.** Ahora `lol backfill`, segunda fase del botón de
  sincronizar del panel, y un contador `sin timeline` en cada tarjeta de cuenta más una acción en
  "qué hacer ahora". G-035.
- **G · El panel no podía arrancar solo.** Resolver una cuenta existía únicamente como tool de
  MCP, así que un clon nuevo abría el panel y recibía cinco 404 `no conozco la cuenta 'smurf'` sin
  nada que hacer. `lol cuenta`, `POST /api/cuenta`, y el panel esconde las secciones de lectura y
  muestra un formulario mientras no haya cuentas. ADR-023.

**Un bug nuevo, cometido y atrapado durante la sesión:** un backtick dentro de un comentario
JSDoc adentro de `CLIENT_SCRIPT` terminó el template literal 300 líneas antes. El test de G-022 lo
agarró sólo porque lo que se derramó resultó ser TypeScript inválido — podría haber parseado y no
significar nada. G-034 prohíbe el byte y lo chequea por test.

verify verde, **319 tests** (289 → 319). Nada de esto se tocó en su máquina: la caché sintética
vive en `data/`, que es gitignoreado, y se borró al terminar.

### Lo que quedó afuera a propósito

- Los ~103 `useLiteralKeys` de Biome y el `$schema` pineado en 2.5.1 contra el 2.5.8 instalado.
  105 renglones de ruido esperado en cada `verify` entrenan a saltear el que sí importa (G-026 al
  revés), pero es un diff cosmético y no se pidió.
- `engines: >=24` contra un piso real de 22.18 — `preflight()` avisa abajo de 22 y la suite entera
  pasa en 22.22. `pnpm install` tira "Unsupported engine" en cada instalación.
- Ocho constructores de timeline duplicados en tests, porque `fixtures.ts` tiene builders de match
  y ninguno de timeline.
- Menores: `queryParticipants` acepta `role: string` y devuelve 0 filas en silencio ante un rol
  desconocido (lo pisa `Role` en la capa de análisis, pero el store no); "presente en 0/0 peleas";
  `catalogForPatch` ordena versiones como texto, así que `.9` gana sobre `.10` dentro de un mismo
  parche.

## S10 2026-08-20, CLOUD — el panel se pliega, y dos dimensiones que ya estaban

Dos pedidos: (1) que se vea mejor y no haya tanto en pantalla de una, con desplegables; (2) que
si hace falta bajar librerías o buscar APIs y datos externos, se haga.

**LIBRERÍAS: ninguna, y el permiso se gastó en otra cosa.** El panel es 1.900 líneas de vanilla
sobre `node:http`, sin build step (ADR-003). Meter Chart.js o similar es o un `<script>` a un CDN
— que rompe la promesa del header, igual que ADR-021 rechazó hotlinkear el arte de Riot — o
vendorear un blob minificado al repo más una ruta que lo sirva. El hover que faltaba en la curva
salió en 40 líneas de vanilla sobre el SVG que ya existe. El permiso rindió en los DATOS.

### El panel (ADR-024, ADR-025)
- Una tarjeta dice qué hacer ahora; el resto son once secciones plegadas que se calculan recién
  al abrirlas. Cada título lleva su número (*Taguear 45*, *key falta*): cerrada no es a ciegas.
  Se acuerdan de cómo las dejó. El arranque pasó de nueve renders y cinco fetches a dos.
- **El alcance era una mentira**: `cuenta=smurf` estaba escrito en el JavaScript del panel y
  `role:'MIDDLE', queueId:420` adentro de `momentos` y `graficos`. La main era inalcanzable desde
  una página que la listaba, y toda partida fuera de mid soloq era invisible sin que nada dijera
  que había un filtro. Ahora cuenta/rol/cola se eligen arriba, viajan en la URL y las lee cada
  ruta; la memo del mapa incluye el alcance.
- Partidas: lista filtrable por campeón, resultado, tag y rival, con el detalle completo de cada
  una al desplegarla — es `riot_match_detail` hecho visible.
- Avisos apilados, atajos (1/2/3, s, p, e/E, ?), buscador en cobertura, tooltip en la curva.

### Runas y clases (ADR-026) — lo que el permiso de "APIs externas" compró de verdad
**Los perks estaban en la caché desde el primer sync y nada los leía.** ADR-004 guarda el JSON
completo justamente para esto: sólo faltaba una tabla que dijera qué significa cada id. Bajarla
no cuesta un solo request de Riot — Data Dragon es otro host, sin key y sin limiter.

- `lol catalogos` (alias `lol items`) baja tres tablas por parche: ítems, **runas** (62, 17
  keystones) y **campeones** (173, con sus clases). `lol assets` baja los íconos de keystone.
- `src/analysis/runes.ts`: keystone = slot 0 del árbol primario, que es la definición y no una
  lista de ids que envejece cada pretemporada. Tabla por keystone, la suya y la del rival, con n.
- `src/analysis/classes.ts`: récord contra cada clase de rival. Es el ÚNICO agrupamiento de
  rivales que existe antes de que empiece la partida, así que es el único usable como estrato sin
  heredar el resultado. Tabla entera siempre (G-028); un campeón con dos clases cuenta en las dos
  y el panel dice que por eso las filas no suman.
- Las dos son DESCRIPCIÓN y lo dicen en pantalla: no elegís keystone al azar.

### Bugs, casi todos míos y todos encontrados abriendo la página
- `esc()` era código muerto y lo usé sobre el script: adentro de `<script>` las entidades no se
  decodifican, así que cada arrow function quedó como entidad. Panel en blanco, consola vacía.
  G-036.
- Backtick en un comentario CSS terminó `CLIENT_STYLE` 300 líneas antes. G-037. **Volví a
  cometerlo dos veces más en esta sesión**; el test lo agarró las tres, que es exactamente para
  lo que está.
- `.ahora` era la tarjeta hero Y el modificador de urgencia: un punto de 6px salió como blob de
  40px. G-038.
- La cuenta por defecto salía de un `GROUP BY` sobre `participants` — que tiene a los diez
  jugadores — así que devolvía un desconocido y caía al orden alfabético. G-039.
- **LeBlanc sin clase**: el catálogo se keyeaba por el `id` de Data Dragon (`Leblanc`) y se leía
  con el `championName` de Riot (`LeBlanc`). G-016 por tercera vez. G-040.
- `KeystoneRow` no llevaba `runeId`, así que todos los íconos pedían `undefined.png` y el
  `onerror` los borraba en silencio: la tabla simplemente no tenía fotos. G-041.

verify verde, **351 tests** (332 → 351). Visto en Chromium, con arte real, cero errores de
consola.

### Para la próxima sesión, con datos reales
Correr una vez: `pnpm lol catalogos` y `pnpm lol assets`. Todo lo de S10 se verificó sobre 45
partidas sintéticas con varianza cero — la forma está probada, los números todavía no dijeron
nada. La vista que nunca existió y que miraría primero es *Cómo viene* sin filtrar por rol.

## S11 2026-08-20, CLOUD — las dos cosas que op.gg no puede hacer

Pedido: que sea de verdad superior a op.gg o Mobalytics, personalizado para mejorar en mid y
llegar a Diamante o Maestro. La respuesta no fue una lista de features: fueron las dos cosas que
esas herramientas **estructuralmente** no pueden hacer, porque no tienen sus timelines ni su
historial de rango.

### La forma del matchup (ADR-027)
`src/analysis/signature.ts` + `signatureSvg`. El oro contra su rival de línea en cada minuto
muestreado, promediado sobre TODAS sus reps, dibujado como cada partida en gris con el promedio
encima — la forma de ÉNFASIS, y es el argumento, no la decoración.

op.gg sabe el winrate de Diana contra Zed sobre diez mil partidas y no tiene un solo timeline.
"Estás +100 a los 14 y la diferencia recién se abre después del 20" no es una frase que pueda
producir. El winrate dice que el matchup es difícil; la forma dice DÓNDE se rompe.

Tres decisiones para que no sea la mentira habitual de un promedio:
- **n POR MINUTO.** Las partidas terminan: quince a los 5′ y diez a los 30′ son dos muestras en
  una línea. El promedio se AFINA donde baja la n y cada tick imprime la suya.
- **Cada rep viaja al cliente.** Un promedio de ocho partidas con 2000 de dispersión y ocho que
  hicieron lo mismo son el mismo número y hechos distintos. Se dibuja en vez de describirse.
- **El peor tramo se atribuye a la MENOR de sus dos n**, porque una caída hacia un punto flaco es
  un hecho sobre el punto flaco.
Nada de esto está en el ledger y el panel lo dice: es la descripción de un dibujo.

### El camino, con tres números (ADR-028)
`src/analysis/climb.ts`. Winrate medido + los dos extremos de su intervalo de Wilson.

Sobre la caché sintética: Platino I 38 LP, faltan 462 LP. **+24.2 / −17.3 LP medidos de sus
propios snapshots**, equilibrio 41.7%. Winrate 53.3% n=45, intervalo 39.1–67.1%. Central 96
partidas · optimista 44 · **pesimista: `null`, "con 39% no subís"**. Ese null es la feature.

- El LP por partida sale del reloj de rango, no de un 20 de manual: depende de la distancia entre
  su MMR y su división y se mueve mientras sube. Ninguna app lo sabe porque ninguna muestrea su
  rango en un reloj; este proyecto sí, en cada sync, deduplicado por valor.
- Un par de snapshots donde se movieron LOS DOS contadores se descarta: tres victorias y dos
  derrotas sobre un salto de LP son cuatro incógnitas y una ecuación.
- Wilson y no la aproximación normal, que da cotas fuera de [0,1] justo con muestra chica — una
  barra que arranca en −4% haría que la mitad honesta de la tarjeta parezca un bug.

### Bugs
- **G-043**: `partidasPara(300, 0.6, +22/−18)` son exactamente 50 partidas y devolvía 51.
  `0.6*22 − 0.4*18` es 5.999999999999999 en flotante, así que el cociente es 50.00000000000001 y
  el ceil suma una. Una partida de más, en el número principal de la tarjeta.
- **G-042**: el agregado sobre una serie que se ENCOGE tiene que llevar su n por punto y el
  dibujo tiene que mostrarlo. Hermano de G-017, que era el mismo error sobre los frames de una
  partida en vez de sobre un corpus.
- El test de G-023 (toda clase emitida tiene regla) no partía las clases compuestas, así que
  `class="rep gano"` buscaba una regla llamada `.rep gano` y la encontraba por accidente.
  Corregido junto con el builder nuevo.

### S11b — la medición que no medía nada en su caché
Preguntó si existía la sección de "cuántas partidas faltan". Existía, y **no le hubiera dado un
número**: `lpMedido` sólo leía tramos donde se movió UN solo contador, que es el caso con una
incógnita y una ecuación. Correcto, y sobre su caché real aplica a CERO tramos — el reloj se
muestrea en un sync, un sync pasa después de una sesión, y una sesión son varias partidas.

- Ahora ajusta **todos los tramos a la vez** por mínimos cuadrados: seis victorias y una derrota
  siguen siendo una ecuación con dos incógnitas, pero tres tramos así ya no lo son. G-044.
- Cuando aun así no hay ajuste (menos de dos tramos, tramos colineales, o un resultado fuera de
  lo que el LP puede valer) usa un supuesto de ±20 **etiquetado**: `LpMedido.origen` viaja con la
  respuesta y el panel lo pinta en amarillo. G-045.
- Probado con sus tres snapshots reales: cae al supuesto y dice por qué ("el ajuste dio 79 LP por
  victoria, fuera de rango"). 347 partidas a Diamante al ritmo supuesto, 68 si va bien, nunca si
  va mal. Con el LP medido de verdad el central baja a ~96: por eso la etiqueta importa.

verify verde, **377 tests** (351 → 377). Visto en Chromium, cero errores de consola.

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
