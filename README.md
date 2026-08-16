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

Tiene que listar 7 tools y decir que la key está presente.

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

## Las tools

| Tool | Para qué |
|---|---|
| `riot_key_status` | Si hay key, qué tipo es y hace cuánto se pegó. Nunca muestra el valor. Primer diagnóstico cuando algo falla. |
| `riot_resolve_account` | Riot ID → puuid, nivel y rango por cola. Guarda la cuenta para referirte a ella después por nombre o etiqueta. |
| `riot_sync` | Baja partidas a la caché. Idempotente: lo que ya está no se vuelve a pedir. |
| `riot_matches` | Lista lo que hay en la caché, con filtros. No pega a la API. |
| `riot_benchmark` | **La importante.** Tus métricas contra los otros jugadores de tus propias partidas, de peor a mejor. |
| `riot_match_detail` | Una partida completa; con timeline, las diferencias de oro/CS/XP a los 10, 15 y 20. |
| `riot_cache_status` | Qué hay bajado, por cuenta y por cola. |

Flujo típico la primera vez:

```
riot_resolve_account  gameName=legendoftorcuato tagLine=las label=smurf
riot_sync             account=smurf queue=soloq max=100
riot_benchmark        account=smurf role=mid
```

## Cómo se arma el benchmark

No compara contra un "promedio de Platino" sacado de otro lado. **La referencia son los
otros nueve jugadores de tus propias partidas**, que Riot ya emparejó a tu MMR.

En las métricas por rol eso es exactamente una persona por partida: tu rival de línea. Cien
partidas sincronizadas son cien mid laners de tu elo, sin gastar un solo request extra. Es
la comparación correcta para "dónde pierdo", con la salvedad de que son los rivales que te
tocaron, no una muestra aleatoria de la división.

Se reporta tamaño de efecto y n, nunca p-values. Cuando la muestra es chica, lo dice en vez
de mostrar un número que parece confiable.

## Cuánto tarda un backfill

El límite de 100 requests cada 2 minutos manda: son unas **50 partidas por minuto**, la
mitad si pedís timelines. Trescientas partidas son unos 7 minutos. Se paga una sola vez —
las partidas terminadas no cambian, así que la caché nunca se invalida y los syncs
siguientes solo traen lo nuevo.

## Desarrollo

```bash
pnpm verify   # Biome + tsc + Vitest, la puerta de "listo"
pnpm fix      # autoformat
pnpm smoke    # levanta el servidor real y ejercita las tools
```

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
- No es una app. Es un servidor de datos para conversar; la UI se decide más adelante.
