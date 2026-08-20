# riot-mcp

Servidor MCP local sobre la Riot API. Sirve para que Claude pueda leer y analizar tus
partidas de League of Legends sin el techo de 20 partidas que tiene op.gg.

La v1 responde una pregunta: **dónde perdés contra tu propio elo.**

## Empezar (una vez)

**1. Instalar** — Node 24 o superior, que ya trae SQLite y corre TypeScript sin compilar.

```bash
pnpm install
```

**2. Conseguir la key de Riot.** Es lo único que bloquea; sin esto no hay datos.

- Entrá a <https://developer.riotgames.com> y hacé login con tu cuenta de Riot
- Bajá hasta **DEVELOPMENT API KEY** y apretá **REGENERATE API KEY**
- Copiá el valor, que empieza con `RGAPI-`

**3. Pegarla.** Copiá el archivo de ejemplo y pegá la key adentro:

```bash
cp .env.example .env
```

Abrí `.env` en el editor y pegá la key después de `RIOT_API_KEY=`. Nada más.

**4. Comprobar que arrancó:**

```bash
pnpm smoke
```

Tiene que listar las 14 tools y decir que la key está presente.

## La key caduca cada 24 horas

Las keys de desarrollo mueren a las 24 h. Cuando las llamadas empiecen a fallar con 401 o
403, volvé al portal, regenerala, pegá la nueva en `.env` y seguí: **el servidor relee el
archivo en cada request**, así que no hay que reiniciar nada.

Para dejar de rotarla, pedí una **Personal API Key** en el mismo portal
(`REGISTER PRODUCT`). Mismo rate limit, pero no caduca. Tarda de días a semanas.

| Tipo de key | Rate limit | Caduca |
|---|---|---|
| Development | 20/s · 100 cada 2 min | **cada 24 h** |
| Personal | 20/s · 100 cada 2 min | no |
| Production | 500/10s · 30.000/10 min | no (requiere producto aprobado) |

## El ritual

Cuando terminás de jugar, **doble click a `lol-ui.bat`**. Desde la terminal es `pnpm lol ui`.

El acceso directo del escritorio ya está hecho y apunta acá; si alguna vez hay que rehacerlo,
el icono es `assets/lol-lab.ico` y el destino es este `.bat` con el repo como carpeta de inicio.

Abre el panel en el navegador y a partir de ahí no volvés a la terminal.

Arriba de todo elegís **cuenta, rol y cola**: todo lo de abajo se lee con ese filtro y queda en la
URL, así que si recargás caés donde estabas. Debajo, una sola tarjeta dice **qué hacer ahora** y
trae el botón que lo hace.

El resto son **secciones plegadas**, y se pliegan a propósito: una pantalla con todo abierto es un
informe, no algo que se usa a las dos de la mañana después de jugar. Cada título lleva el número
adentro — *Taguear 45*, *key falta* — así que cerrada no significa a ciegas, y ninguna sección
calcula nada hasta que la abrís. Se acuerdan de cómo las dejaste.

| Sección | Qué hay |
|---|---|
| **Cómo viene** | winrate con su n, la tira de las últimas 20 (V/D, la más nueva a la derecha), la racha, lo de hoy, y las métricas causales contra tu rival de línea. Adentro, el desglose por campeón. |
| **Taguear** | las partidas sin taguear, tres botones cada una. Teclas `1` `2` `3`. Se abre sola si hay algo pendiente. |
| **Sincronizar** | el botón con su barra, en dos fases: partidas nuevas y después timelines viejos. |
| **Partidas** | la lista completa, filtrable por campeón, resultado, tag y rival. Cada fila se despliega con TODO lo derivable de esa partida: curva de oro, fases, peleas, muertes, épicos, tempo, roams, build con íconos y los momentos más caros. |
| **Lo que salió caro** | las últimas cinco, con la build y los tres momentos de cada una. |
| **Curva y mapa** | la curva de oro de la última partida medible y el mapa de muertes sobre el minimapa real. |
| **Antes de entrar** | el matchup: tu récord acá, tus reps en todas las cuentas, el meta de op.gg. |
| **De qué no puedo hablar** | la cobertura, con buscador. |
| **Hipótesis** | el ledger. |
| **Cuentas y key** | rango por cola, pendientes, dejadas atrás, sin timeline, último sync, y el estado de la key. |

Atajos: `1` `2` `3` taguear · `s` sincronizar · `p` partidas · `e` expandir todo, `E` contraer ·
`?` la ayuda. Nada que no se pueda hacer con el mouse.

El **tag** es lo único que el software no puede sacar solo, y es lo que separa "jugué mal" de
"me tocó mal". Cada click se guarda en el momento: si cerrás la pestaña a la mitad, lo que ya
marcaste queda. Una partida sin taguear no se puede taguear en noviembre.

El servidor escucha solo en `127.0.0.1` y la URL lleva un token que cambia en cada arranque, así
que guardar el favorito no sirve. **Mientras la ventana negra esté abierta, el panel funciona**;
cerrarla lo apaga. Si el puerto 4477 está ocupado se corre solo al siguiente y te lo dice.

La primera vez vas a ver tus partidas viejas sin taguear todas juntas: la lista muestra las de
las últimas 12 horas y deja el resto plegado. Taguear una partida de hace dos semanas es
acordarse, no observar — el software anota cuánto tardaste, así que no se mezclan.

Si preferís la terminal, `pnpm lol cerrar` hace el mismo ritual con una tecla por partida
(`y` la produje yo · `i` salía igual · `p` estuvo pareja). `pnpm lol` solo lista todo lo demás:
`cuenta`, `report`, `prep`, `cobertura`, `growth`, `page`, `hip`, `rank`, `items`, `backfill`.

`pnpm lol cuenta <Nombre#TAG> [etiqueta]` es el primer paso de todo: resuelve el Riot ID y lo
guarda con el nombre corto que después usa el resto (`lol report smurf`).

`pnpm lol backfill` baja los timelines que falten de partidas que ya están en la caché. Hace
falta porque `riot_sync` sólo pide el timeline de las partidas que está bajando en ese momento:
una partida que entró sin él se queda sin él para siempre, y **sin timeline no hay minuto** — ni
estado de línea, ni conversión, ni momentos caros, ni ítems, ni mapa de muertes. El panel lo
corre solo como segunda fase del botón de sincronizar, y te dice cuántas quedan.

`pnpm lol items` es de una sola vez por parche: baja la tabla de ítems de Data Dragon (sin key,
sin rate limit, un catálogo por parche que hayas jugado) y con eso el reporte y el panel pueden
decirte cuándo completaste cada ítem y cuándo lo completó tu rival de línea. Después de un parche
nuevo, corrélo una vez.

`pnpm lol assets` es de una sola vez a secas: baja los retratos de campeón, los íconos de ítem y
el minimapa (5.9 MB) a `data/img/`, y el panel los sirve desde tu máquina. No hay hotlink a la
CDN de Riot: sin esto la página funciona igual, pero en texto.

## Las tools

Dos prefijos: `riot_*` toca la API y la caché, `lol_*` le pregunta cosas al motor y no gasta
un solo request.

| Tool | Para qué |
|---|---|
| `riot_key_status` | Si hay key, qué tipo es y hace cuánto se pegó. Nunca muestra el valor. Primer diagnóstico cuando algo falla. |
| `riot_resolve_account` | Riot ID → puuid, nivel y rango por cola. Guarda la cuenta para referirte a ella después por nombre o etiqueta. |
| `riot_sync` | Baja partidas a la caché. Idempotente: lo que ya está no se vuelve a pedir. |
| `riot_backfill_timelines` | Baja los timelines de partidas que YA están en la caché. Sin timeline una partida no tiene datos por minuto y queda fuera de casi todo. Desde la terminal es `lol backfill`, y el panel lo hace solo al sincronizar. |
| `riot_matches` | Lista lo que hay en la caché, con filtros. No pega a la API. |
| `riot_benchmark` | **La importante.** Tus métricas contra los otros jugadores de tus propias partidas, de peor a mejor. |
| `riot_match_detail` | Una partida completa; con timeline, las diferencias de oro/CS/XP a los 10, 15 y 20. |
| `riot_cache_status` | Qué hay bajado, por cuenta y por cola. |
| `lol_prep` | El matchup antes de jugarlo: tu récord en esa cuenta, tus reps en todas, y el meta. Separados. |
| `lol_coverage` | De qué **no** puede hablar todavía, y cuántas partidas faltan. |
| `lol_hypotheses` | El ledger: qué está registrado como predicción fechada y cómo va. |
| `lol_tags` | Cómo se repartieron los resultados según a quién se los atribuiste. |
| `lol_tag` | Taguear una partida suelta, para la noche que no corriste `lol cerrar`. |
| `lol_rank` | Dónde está cada cuenta y qué se movió desde que arrancó el reloj. |

Flujo típico la primera vez, conversando:

```
riot_resolve_account  gameName=legendoftorcuato tagLine=las label=smurf
riot_sync             account=smurf queue=soloq max=100
riot_benchmark        account=smurf role=mid
```

Nada de esto es obligatorio para arrancar: **el panel y la terminal registran una cuenta solos**
(`lol cuenta LegendofTorcuato#LAS smurf`, o el formulario que aparece en el panel cuando la caché
está vacía). Antes el primer paso sólo existía como tool de MCP, así que un clon nuevo abría el
panel y no tenía por dónde empezar.

## Cómo se arma el benchmark

No compara contra un "promedio de Platino" sacado de otro lado. **La referencia son los
otros nueve jugadores de tus propias partidas**, que Riot ya emparejó a tu MMR.

En las métricas por rol eso es exactamente una persona por partida: tu rival de línea. Cien
partidas sincronizadas son cien mid laners de tu elo, sin gastar un solo request extra. Es
la comparación correcta para "dónde pierdo", con la salvedad de que son los rivales que te
tocaron, no una muestra aleatoria de la división.

Se reporta tamaño de efecto y n, nunca p-values. Cuando la muestra es chica, lo dice en vez
de mostrar un número que parece confiable.

Dos puertas antes de que una métrica pueda encabezar el reporte, y hay que pasar las dos:

- **¿el número está contaminado por el resultado?** El que farmea más porque va ganando no te
  dice nada sobre por qué gana. Una métrica contaminada se muestra como descripción y no se
  rankea, salvo que fijes un estado de partida.
- **¿el número tiene tamaño?** Varios campos `challenges` de Riot son banderas 0/1 disfrazadas
  de magnitud. Un percentil sobre una bandera dice cuántas veces la prendés y nunca por cuánto
  — así se publicó una vez un "percentil 97 en ventaja de oro+XP" que era una moneda. Las
  banderas se informan como TASA, sin percentil y sin tamaño de efecto. Y la declaración se
  vuelve a chequear contra la muestra: una métrica declarada magnitud que en tus datos sólo
  toma 0 y 1 se degrada sola y te lo dice.

## Cuánto tarda un backfill

El límite de 100 requests cada 2 minutos manda: son unas **50 partidas por minuto**, la
mitad si pedís timelines. Trescientas partidas son unos 7 minutos. Se paga una sola vez —
las partidas terminadas no cambian, así que la caché nunca se invalida y los syncs
siguientes solo traen lo nuevo.

## Desarrollo

```bash
pnpm verify   # Biome + tsc + Vitest, la puerta de "listo"
pnpm fix      # autoformat
pnpm smoke    # levanta el servidor MCP real y ejercita las tools
pnpm lol      # los rituales, desde la terminal
pnpm lol ui   # el panel
```

Tres front-ends sobre una sola librería (`src/analysis/`, pura y sin I/O): el servidor MCP para
conversar, la CLI para los rituales, y la UI local. Si algo te obliga a tocar `src/analysis/`
para agregar una vista, el seam está mal.

Dos cosas que hay que saber antes de tocar el código:

- **Nada puede escribir en stdout** dentro de `src/server.ts`: ese canal es el protocolo
  JSON-RPC y un solo byte de más lo rompe. Los diagnósticos van a stderr. Biome lo prohíbe.
- **TypeScript borrable únicamente**: Node borra los tipos sin compilador, así que `enum`,
  `namespace` y las propiedades de parámetro fallan en tiempo de ejecución, no en el
  typecheck. `erasableSyntaxOnly` en el tsconfig lo atrapa antes.

El resto de las decisiones y las trampas conocidas están en `.agent/`.

## Qué NO hace

- No escribe en el vault de Obsidian. Lee de Riot y guarda en su propia caché.
- No reemplaza a `vault/90-meta/scripts/opgg_pull.py`: op.gg sigue siendo la fuente del
  meta (winrate de matchups sobre muestras de miles de partidas), que Riot no da. Son
  complementarias.
- No es una app en la nube. La UI corre en tu máquina, escucha solo en localhost y no publica
  nada: si el proceso no está levantado, no hay UI.
