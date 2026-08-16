# Prompt para la sesión de planificación — OBSOLETO, no volver a usar

> **Este prompt ya cumplió su función (sesión del 2026-08-16) y NO debe pegarse de nuevo.**
> La sección "Lo que ya aprendimos de mis datos" afirma *"estoy arriba en 17 de 18 métricas"*
> y *"mi fuga no está en cómo juego mi línea"* — esa misma sesión demostró que era un
> artefacto de promediar palizas (ver `journal.md` 2026-08-16 y ADR-009). Volver a pegarlo
> reinyecta la conclusión equivocada como si fuera punto de partida.
>
> **Para retomar el proyecto usá `prompt-sesion.md`.**
> Se conserva este archivo como registro histórico del encargo original.

Copiá todo lo que está debajo de la línea y pegalo en un chat nuevo.

---

Quiero planificar un software para mejorar en League of Legends. Hoy vamos a **planificar,
no a programar**: quiero un plan que discutamos y que yo apruebe antes de que escribas código.

## Qué quiero lograr

Llegar al elo más alto que pueda. Concretamente quiero mejorar en: **matchups** (cómo se
juega cada uno, qué hacer en cada fase), **teamfights**, **visión** y **farmeo**. Y todo lo
demás que los datos digan que me está frenando, aunque yo no lo haya pedido.

No quiero un dashboard lindo. Quiero algo que me diga qué hacer distinto la próxima partida.

## Cómo juego

- Juego **mid**, siempre.
- Mis campeones son **Diana, Locke y Yone**. Puedo jugar otros pero esos tres son el 90%.
- Tengo **dos cuentas con propósitos distintos, y no hay que mezclarlas**:
  - **`LegendofTorcuato#LAS` (smurf)** — cuenta de práctica: mecánicas, limit testing,
    probar builds y matchups. Acá la varianza es buena, la idea es equivocarse a propósito.
    Platino 2. Tiene ~60 partidas ya cargadas.
  - **`LaMarso#LAS` (main)** — acá juego para subir. Consistencia, no experimentos. Nivel
    301, hoy unranked, con 11 partidas viejas de normales (la última es de abril).
- **Timing importante**: esta es mi última semana jugando en la smurf. **A partir de la
  semana que viene arranco en la main**, así que la main no va a tener datos hasta entonces.
  El plan tiene que ser construible y testeable con datos de la smurf ahora, y estar listo
  para recibir la main cuando empiece.

Que las dos cuentas tengan objetivos distintos debería cambiar qué se mide en cada una. Si
te parece que estoy equivocado en eso, decímelo.

## Qué ya existe

Todo esto anda y está verificado. Leelo antes de proponer nada — no lo rehagas sin razón,
pero tampoco lo trates como intocable.

**`~/Documents/riot-mcp`** — servidor MCP local sobre la Riot API. TypeScript, Node 24, sin
build step, caché SQLite en `data/riot.db`. Siete tools: `riot_key_status`,
`riot_resolve_account`, `riot_sync`, `riot_matches`, `riot_benchmark`, `riot_match_detail`,
`riot_cache_status`. 38 tests, `pnpm verify` verde. Guarda el JSON crudo de cada partida
entero, así que cualquier métrica nueva sale de la caché sin volver a pegarle a la API.
Empezá leyendo `.agent/state.md`, `.agent/decisions.md` y `.agent/guardrails.md`.

**`~/Documents/vault`** — mi second brain en Obsidian. Tiene notas de LoL (campeones,
matchups, sesiones) y también salud, finanzas y papers. Es **capa de decisión, no de
telemetría**: los datos crudos van a `_raw/` en CSV, al markdown solo llegan agregados.
Sus reglas están en `vault/CLAUDE.md` y son estrictas — leelas antes de escribir ahí.

**`~/Documents/athlete-os`** — Next.js 16 + React 19 + Supabase + Tailwind, desplegado en
Vercel, 198 tests. **Esto importa más de lo que parece**: sus ADR-005 y ADR-010 dicen que es
"el primer módulo de un all-in-one sobre un core compartido", con `src/core/` y
`src/modules/fitness/`, y rechazan explícitamente el standalone. Ya tiene cargados mi sueño,
HRV, frecuencia cardíaca en reposo, carga de entrenamiento y toggles de alcohol y cafeína. Y
tiene un **motor de patrones andando** (`src/modules/fitness/engine/patterns.ts`) que cruza
esas entradas contra resultados usando tamaño de efecto con veto por correlación de rangos.

**`vault/90-meta/scripts/opgg_pull.py`** — baja datos de op.gg a CSV. Sigue siendo útil:
op.gg tiene winrates de matchups sobre muestras de miles de partidas (el meta), que la Riot
API no da. Son fuentes complementarias, no redundantes.

## Lo que ya aprendimos de mis datos, y que cambia el problema

Corrimos el benchmark sobre 36 partidas de mid en soloq, comparándome contra los mid que
efectivamente enfrenté (la Riot API devuelve los 10 participantes, así que cada partida
aporta un rival de línea que Riot ya emparejó a mi MMR).

**Estoy arriba en 17 de 18 métricas.** Solo kills percentil 83, ventaja de oro+XP en línea
percentil 97, KDA percentil 92, muertes por minuto percentil 81, CS a los 10 percentil 75.
La única métrica negativa es daño recibido por minuto, con efecto −0.1, que es ruido.

**Y mi winrate es 52.8%.**

O sea: gano la línea contra casi todos y gano la mitad de las partidas. Una fuente
independiente (Mobalytics, con otra muestra) dice lo mismo. **Mi fuga no está en cómo juego
mi línea, está en qué hago después de ganarla** — y eso no se ve en agregados por partida.

Tomá esto como el punto de partida del diagnóstico, no como una conclusión cerrada. Si los
datos dicen otra cosa cuando los mires bien, decímelo.

## A dónde quiero que vaya

Quiero que en algún momento esto cruce **datos de mi vida** contra mi rendimiento: sueño,
entrenamientos, estrés, gastos, lo que sea que se pueda medir. Saber si juego peor sin
dormir, a partir de qué partida del día empiezo a perder, si el gimnasio me ayuda o me
funde. No hace falta que esté en la v1, pero la arquitectura no debería hacerlo imposible.

Fijate que athlete-os ya tiene la mitad de eso construido y su roadmap decía que le faltaban
justamente los **resultados** contra los cuales correlacionar. Sacá vos la conclusión.

## Tu libertad

Esto es un proyecto personal, de hobby, un solo usuario, corriendo local. **Tenés vía libre.**

- Proponé la arquitectura que te parezca mejor, aunque implique tirar o reescribir lo que
  hay. Si `riot-mcp` tiene que dejar de ser un MCP suelto, decilo.
- Agregá lo que se te ocurra que sirva y yo no pedí. Prefiero que propongas de más y yo
  recorte, a que te quedes corto.
- **No gastes esfuerzo en seguridad de aplicación**: no hay usuarios además de mí, no hay
  datos de terceros, no hay superficie pública. Nada de multi-tenancy, roles ni modelos de
  amenaza. Lo único que sí importa: que las API keys no terminen commiteadas.
- Pensá también en **cómo el software se mejora solo con el tiempo**: que detecte cuándo una
  métrica dejó de servir, que proponga qué medir después, que aprenda de mis partidas nuevas.
  Esto me sirve además como banco de pruebas para software futuro, así que las ideas
  generalizables valen doble.

## Restricciones reales

- **Riot API**: 20 requests por segundo y **100 cada 2 minutos**, por región, tanto para la
  key de desarrollo como para la personal. Solo una key de producción sube eso. La de
  desarrollo **caduca cada 24 horas**; ya pedí la personal, que no caduca. Un backfill son
  ~50 partidas por minuto, el doble de lento si se piden timelines.
- **La main no tiene datos hasta la semana que viene.** Nada que dependa de ella se puede
  validar todavía.
- Servidor LAS: plataforma `la2`, ruteo regional `americas`.

## Trampas que ya nos costaron caro

No las repitas, y tratalas como ejemplos del tipo de error que hay que buscar:

1. **Todo en LoL depende del rol.** Comparé mi vision score contra un pool que incluía
   supports (que tienen 2-3x por diseño) y salió como mi peor métrica, encabezando el
   reporte. Era un artefacto. Un n más grande comprado con un pool sesgado es peor que un n
   chico honesto.
2. **Un solo estadístico no alcanza para decidir si hay diferencia.** Cohen's d da NaN
   cuando las dos muestras tienen varianza cero, y eso hacía que una brecha real se
   reportara como "parejo".
3. **Los empates no son derrotas.** Varios campos de Riot son ordinales que valen 0 casi
   siempre; contar solo victorias estrictas hacía que una métrica de percentil 97 se leyera
   como "12 de 36".
4. **op.gg fecha las partidas cuando terminan, Riot cuando empiezan.** Una partida que
   arranca 23:40 cae en días distintos según la fuente.
5. **Las tools del MCP de op.gg no se pueden usar**: publica un `outputSchema` malformado y
   Claude Code rechaza la lista entera, aunque el servidor figure como conectado. Por eso
   existe `opgg_pull.py`, que le habla JSON-RPC a mano.
6. **No mezclar contextos distintos en un mismo contador.** Flex y soloq juegan en divisiones
   distintas; smurf y main tienen propósitos distintos. Un promedio que los mezcla no
   significa nada.

## Qué quiero de esta sesión

Un plan que pueda leer y aprobar. Me interesa que incluya:

- Qué debería medir el software que hoy no mide, dado que mi fuga no está en la línea.
- Dónde vive: repo aparte, módulo de athlete-os, otra cosa. Con el porqué.
- Cómo se separan smurf y main sin mezclarse, y qué se mide distinto en cada una.
- Qué hago yo, con qué frecuencia, y qué me devuelve el software a cambio.
- Por dónde se empieza y qué queda para después.

Antes de proponer, leé el código y las notas que te mencioné. Preguntame lo que necesites:
prefiero contestar tres preguntas ahora que aprobar un plan que apunta al lado equivocado.
