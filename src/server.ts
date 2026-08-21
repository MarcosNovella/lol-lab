import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { benchmark, formatComparison, mostPlayedRole } from './analysis/benchmark.ts';
import {
  splitByTag,
  TAGS,
  type Tag,
  tagGame,
  taggedRows,
  untaggedGames,
} from './analysis/capture.ts';
import { coverageOf, coverageTotals } from './analysis/coverage.ts';
import { evaluateHypothesis, evaluationsOf, listHypotheses } from './analysis/hypotheses.ts';
import { collectMatchups } from './analysis/matchups.ts';
import { standardMeasure } from './analysis/measures.ts';
import { normaliseRole, type Role, roleLabel } from './analysis/metrics.ts';
import { sameChampion } from './analysis/names.ts';
import { confidenceOf, prepMatchup } from './analysis/prep.ts';
import { loadPriors, priorFor, priorsKeyedLike } from './analysis/priors.ts';
import { describeRank, latestSnapshot, snapshotHistory, TRACKED_QUEUES } from './analysis/rank.ts';
import { assembleBriefing, PregameError } from './pregame.ts';
import { createClient } from './riot/client.ts';
import { keyState } from './riot/key.ts';
import { platformLabel } from './riot/routing.ts';
import { QUEUE, type QueueName, queueLabel } from './riot/types.ts';
import { exposureOf, gamesSince } from './store/briefings.ts';
import { type Db, openDb } from './store/db.ts';
import {
  cacheStats,
  findAccount,
  getRawMatch,
  getRawTimeline,
  listAccounts,
  queryParticipants,
} from './store/matches.ts';
import { backfillTimelines, resolveAccount, syncMatches } from './sync.ts';

/**
 * MCP server. Talks JSON-RPC over stdio.
 *
 * Two prefixes, and the split is meaningful rather than historical: `riot_*` tools touch the
 * API and the cache — resolve, sync, backfill, what is downloaded — while `lol_*` tools ask the
 * engine questions and never spend a request. The second group is the same library `src/cli.ts`
 * drives (ADR-006, two front-ends over one pure analysis layer).
 *
 * WHAT BELONGS HERE AND WHAT DOES NOT: an MCP response is a chat turn, so these answer in
 * summaries and point at the CLI for anything long. A forty-fight report does not fit in one and
 * never will — that is `lol report`.
 *
 * G-001: stdout belongs to the protocol. Nothing here may `console.log` — Biome enforces it,
 * and any diagnostics go to stderr.
 */

const AR_TIME = 'America/Argentina/Buenos_Aires';

let db: Db | null = null;
function database(): Db {
  db ??= openDb();
  return db;
}

function text(body: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: body }] };
}

/** Riot timestamps are UTC epoch ms; Marcos thinks in Argentina time. Always convert. */
function localTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('es-AR', {
    timeZone: AR_TIME,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function localDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('sv-SE', { timeZone: AR_TIME });
}

/**
 * HH:MM in Argentina time. Asks Intl for the clock directly instead of slicing a formatted
 * datetime: es-AR renders 12-hour with a " p. m." suffix, so the obvious `.slice(-5)` prints
 * the suffix rather than the time (G-006).
 */
function localClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('es-AR', {
    timeZone: AR_TIME,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function queueIdFrom(name: QueueName | 'all' | undefined): number | undefined {
  if (name === undefined || name === 'all') return undefined;
  return QUEUE[name];
}

/** Resolves an account reference from the cache, with a useful error when it is not there. */
function requireAccount(needle: string): { puuid: string; label: string } {
  const account = findAccount(database(), needle);
  if (!account) {
    const known = listAccounts(database())
      .map((a) => `${a.gameName}#${a.tagLine}`)
      .join(', ');
    throw new Error(
      `No conozco la cuenta "${needle}". ` +
        (known === ''
          ? 'La caché está vacía: corré riot_resolve_account primero.'
          : `Cuentas en caché: ${known}. Para una nueva, corré riot_resolve_account.`),
    );
  }
  return { puuid: account.puuid, label: `${account.gameName}#${account.tagLine}` };
}

const server = new McpServer({ name: 'lol-lab', version: '0.1.0' });

// ---------------------------------------------------------------- key status

server.registerTool(
  'riot_key_status',
  {
    title: 'Estado de la key de Riot',
    description:
      'Dice si hay key de la Riot API, qué tipo parece ser y hace cuánto se pegó. Nunca ' +
      'muestra el valor. Es el primer diagnóstico cuando algo falla con 401 o 403.',
    inputSchema: {},
  },
  async () => {
    const state = keyState();
    const lines = [
      `Key presente: ${state.present ? `sí (${state.masked})` : 'NO'}`,
      `Región: ${platformLabel(state.platform)} (${state.platform})`,
      `Archivo: ${state.envPath}`,
    ];
    if (state.updatedAt) {
      lines.push(
        `Pegada: ${localTime(state.updatedAt.getTime())}` +
          (state.hoursSinceUpdate !== null ? ` (hace ${state.hoursSinceUpdate.toFixed(1)} h)` : ''),
      );
    }
    if (state.present && state.kind === 'development') {
      lines.push(
        state.likelyExpired
          ? '⚠️ Probablemente caducó: las keys de desarrollo duran 24 h.'
          : 'Las keys de desarrollo duran 24 h desde que se generan.',
      );
    }
    if (state.problem) lines.push('', state.problem);
    return text(lines.join('\n'));
  },
);

// ------------------------------------------------------------ resolve account

server.registerTool(
  'riot_resolve_account',
  {
    title: 'Resolver una cuenta de Riot',
    description:
      'Convierte un Riot ID (gameName + tag) en un puuid, trae nivel y rango por cola, y ' +
      'guarda la cuenta en la caché para poder referirse a ella después por nombre o etiqueta.',
    inputSchema: {
      gameName: z.string().describe('Nombre de invocador, sin el tag. Ej: legendoftorcuato'),
      tagLine: z.string().describe('Tag sin el numeral. Ej: las'),
      label: z
        .string()
        .optional()
        .describe('Etiqueta corta para referirte después a esta cuenta. Ej: smurf, main'),
    },
  },
  async ({ gameName, tagLine, label }) => {
    const client = createClient();
    const account = await resolveAccount(client, database(), gameName, tagLine, label);
    const lines = [
      `${account.gameName}#${account.tagLine} — ${platformLabel(client.platform)}`,
      `Nivel: ${account.summonerLevel ?? 'desconocido'}`,
      `puuid: ${account.puuid}`,
      account.label ? `Etiqueta: ${account.label}` : '',
      '',
    ].filter((l) => l !== '');

    if (account.ranked.length === 0) {
      lines.push('Sin datos de ranked (cuenta unranked esta temporada, o Riot no los devolvió).');
    } else {
      for (const r of account.ranked) {
        const total = r.wins + r.losses;
        const wr = total > 0 ? ((r.wins / total) * 100).toFixed(1) : '—';
        lines.push(
          `${r.queue}: ${r.tier} ${r.division}, ${r.lp} LP — ${r.wins}W-${r.losses}L (${wr}%)`,
        );
      }
    }
    return text(lines.join('\n'));
  },
);

// -------------------------------------------------------------------- sync

server.registerTool(
  'riot_sync',
  {
    title: 'Sincronizar partidas',
    description:
      'Baja partidas a la caché local. Idempotente: lo que ya está no se vuelve a pedir. ' +
      'El rate limit de Riot es 100 requests cada 2 minutos, así que ~50 partidas por minuto; ' +
      'con timeline, la mitad. Empezá con max chico para probar.',
    inputSchema: {
      account: z.string().describe('Riot ID (nombre#tag), etiqueta o puuid ya en caché'),
      queue: z
        .enum(['soloq', 'flex', 'draft', 'blind', 'aram', 'all'])
        .default('soloq')
        .describe('Cola a sincronizar'),
      max: z.number().int().min(1).max(1000).default(50).describe('Tope de partidas a bajar'),
      since: z
        .string()
        .optional()
        .describe('Solo partidas desde esta fecha, YYYY-MM-DD (hora argentina)'),
      withTimeline: z
        .boolean()
        .default(false)
        .describe('Bajar también el timeline por minuto. Duplica el costo en requests.'),
    },
  },
  async ({ account, queue, max, since, withTimeline }) => {
    const target = requireAccount(account);
    const client = createClient();
    const startTime =
      since !== undefined
        ? Math.floor(new Date(`${since}T00:00:00-03:00`).getTime() / 1000)
        : undefined;

    const result = await syncMatches(client, database(), {
      puuid: target.puuid,
      ...(queueIdFrom(queue) !== undefined ? { queueId: queueIdFrom(queue) as number } : {}),
      ...(startTime !== undefined ? { startTime } : {}),
      max,
      withTimeline,
    });

    const lines = [
      `${target.label} — cola ${queue}`,
      `IDs vistos: ${result.idsSeen} · ya estaban: ${result.skipped} · bajadas: ${result.fetched}`,
      result.timelines > 0 ? `Timelines: ${result.timelines}` : '',
      result.remakes > 0
        ? `Remakes detectados (excluidos de las estadísticas): ${result.remakes}`
        : '',
      `Tardó ${(result.elapsedMs / 1000).toFixed(1)} s`,
    ].filter((l) => l !== '');

    if (result.errors.length > 0) {
      lines.push('', `Errores (${result.errors.length}):`, ...result.errors.slice(0, 5));
    }
    const budget = client.limiter.budget();
    lines.push(
      '',
      `Presupuesto restante: ${budget.map((b) => `${b.remaining}/${b.limit} en ${b.ms / 1000}s`).join(' · ')}`,
    );
    return text(lines.join('\n'));
  },
);

// ------------------------------------------------------- backfill timelines

server.registerTool(
  'riot_backfill_timelines',
  {
    title: 'Bajar timelines de partidas ya cacheadas',
    description:
      'Baja el timeline por minuto de las partidas que YA están en la caché pero no lo ' +
      'tienen. riot_sync solo trae timeline de las partidas que descarga por primera vez, ' +
      'así que todo lo bajado antes queda sin timeline para siempre; esto lo repara. ' +
      'Idempotente y reanudable: lo que ya tiene timeline no se vuelve a pedir. ' +
      '1 request por partida, ~50 por minuto.',
    inputSchema: {
      account: z.string().optional().describe('Limitar a partidas de esta cuenta'),
      queue: z.enum(['soloq', 'flex', 'draft', 'blind', 'aram', 'all']).default('all'),
      max: z.number().int().min(1).max(1000).default(100).describe('Tope de timelines a bajar'),
    },
  },
  async ({ account, queue, max }) => {
    const target = account !== undefined ? requireAccount(account) : null;
    const client = createClient();
    const queueId = queueIdFrom(queue);

    const result = await backfillTimelines(client, database(), {
      ...(target !== null ? { puuid: target.puuid } : {}),
      ...(queueId !== undefined ? { queueId } : {}),
      max,
    });

    if (result.candidates === 0) {
      return text('No falta ningún timeline con esos filtros. Nada que hacer.');
    }

    const lines = [
      `${target?.label ?? 'todas las cuentas'} — cola ${queue}`,
      `Sin timeline: ${result.candidates} · bajados: ${result.fetched}`,
      `Tardó ${(result.elapsedMs / 1000).toFixed(1)} s`,
    ];
    if (result.errors.length > 0) {
      lines.push('', `Errores (${result.errors.length}):`, ...result.errors.slice(0, 5));
    }
    const pending = result.candidates - result.fetched;
    if (pending > 0) {
      lines.push('', `Quedan ${pending}. Volvé a correrlo: es reanudable.`);
    }
    const budget = client.limiter.budget();
    lines.push(
      '',
      `Presupuesto restante: ${budget.map((b) => `${b.remaining}/${b.limit} en ${b.ms / 1000}s`).join(' · ')}`,
    );
    return text(lines.join('\n'));
  },
);

// ------------------------------------------------------------------ matches

server.registerTool(
  'riot_matches',
  {
    title: 'Listar partidas de la caché',
    description:
      'Consulta las partidas ya sincronizadas, con filtros. No pega a la API: solo lee la ' +
      'caché local. Las fechas y horas salen en hora argentina.',
    inputSchema: {
      account: z.string().describe('Riot ID, etiqueta o puuid'),
      queue: z.enum(['soloq', 'flex', 'draft', 'blind', 'aram', 'all']).default('all'),
      champion: z.string().optional().describe('Filtrar por campeón. Ej: Diana'),
      role: z.string().optional().describe('Filtrar por rol: top, jungla, mid, adc, soporte'),
      since: z.string().optional().describe('Desde esta fecha, YYYY-MM-DD'),
      limit: z.number().int().min(1).max(200).default(20),
      includeRemakes: z.boolean().default(false),
    },
  },
  async ({ account, queue, champion, role, since, limit, includeRemakes }) => {
    const target = requireAccount(account);
    const normalisedRole = role !== undefined ? normaliseRole(role) : null;
    if (role !== undefined && normalisedRole === null) {
      return text(`No reconozco el rol "${role}". Usá: top, jungla, mid, adc o soporte.`);
    }

    const rows = queryParticipants(database(), {
      puuid: target.puuid,
      ...(queueIdFrom(queue) !== undefined ? { queueId: queueIdFrom(queue) as number } : {}),
      ...(champion !== undefined ? { champion } : {}),
      ...(normalisedRole !== null ? { role: normalisedRole } : {}),
      ...(since !== undefined ? { since: new Date(`${since}T00:00:00-03:00`).getTime() } : {}),
      limit,
      includeRemakes,
    });

    if (rows.length === 0) return text('Ninguna partida en la caché con esos filtros.');

    const header =
      'fecha       hora   cola    campeón       rol     res  KDA        CS   CS/m  oro/m  partida';
    const body = rows.map((r) => {
      const kda = `${r.kills}/${r.deaths}/${r.assists}`;
      return [
        localDate(r.gameCreation).padEnd(11),
        localClock(r.gameCreation).padEnd(6),
        queueLabel(r.queueId).padEnd(7),
        r.champion.padEnd(13),
        (r.teamPosition || '—').toLowerCase().padEnd(7),
        (r.win === 1 ? 'win' : 'loss').padEnd(4),
        kda.padEnd(10),
        String(r.cs).padEnd(4),
        r.csPerMin.toFixed(1).padEnd(5),
        Math.round(r.goldPerMin).toString().padEnd(6),
        r.matchId,
      ].join(' ');
    });
    const wins = rows.filter((r) => r.win === 1).length;
    return text(
      [
        `${rows.length} partidas de ${target.label} — ${wins}W-${rows.length - wins}L`,
        '',
        header,
        ...body,
      ].join('\n'),
    );
  },
);

// ---------------------------------------------------------------- benchmark

server.registerTool(
  'riot_benchmark',
  {
    title: 'Dónde pierdo contra mi elo',
    description:
      'Compara sus métricas contra los otros jugadores de sus propias partidas, que Riot ya ' +
      'emparejó a su MMR. Devuelve las métricas ordenadas de peor a mejor, con percentil, ' +
      'tamaño de efecto y n. En métricas por rol la referencia es el rival de línea.',
    inputSchema: {
      account: z.string().describe('Riot ID, etiqueta o puuid'),
      role: z
        .string()
        .optional()
        .describe('top, jungla, mid, adc o soporte. Por defecto, el que más jugó.'),
      queue: z.enum(['soloq', 'flex', 'draft', 'blind', 'aram', 'all']).default('soloq'),
      since: z.string().optional().describe('Desde esta fecha, YYYY-MM-DD'),
      full: z
        .boolean()
        .default(false)
        .describe('Mostrar todas las métricas, no solo el top y el fondo'),
    },
  },
  async ({ account, role, queue, since, full }) => {
    const target = requireAccount(account);
    const queueId = queueIdFrom(queue);

    let chosen: Role | null = role !== undefined ? normaliseRole(role) : null;
    if (role !== undefined && chosen === null) {
      return text(`No reconozco el rol "${role}". Usá: top, jungla, mid, adc o soporte.`);
    }
    chosen ??= mostPlayedRole(database(), target.puuid, queueId);

    const result = benchmark(database(), {
      puuid: target.puuid,
      accountLabel: target.label,
      ...(chosen !== null ? { role: chosen } : {}),
      ...(queueId !== undefined ? { queueId } : {}),
      queueLabel: queue,
      ...(since !== undefined ? { since: new Date(`${since}T00:00:00-03:00`).getTime() } : {}),
    });

    if (result.games === 0) return text(result.notes.join('\n'));

    const lines = [
      `${result.account} — ${result.role === 'todos' ? 'todos los roles' : roleLabel(result.role)}, ${result.queue}`,
      `${result.games} partidas, ${result.wins}W-${result.games - result.wins}L (${result.winRate}%)`,
      result.window.from !== null && result.window.to !== null
        ? `Ventana: ${localDate(result.window.from)} a ${localDate(result.window.to)}`
        : '',
      '',
    ].filter((l) => l !== '');

    if (full) {
      lines.push('TODAS LAS MÉTRICAS (de peor a mejor)');
      // Sorted on `score`, not on `effect`: `effect` is null for a flag and NaN when there is
      // no spread, and `score` is the field that exists to be the ranking key in both cases.
      const sorted = [...result.comparisons].sort((a, b) => a.score - b.score);
      for (const c of sorted) {
        lines.push(`${c.enoughData ? '' : '[muestra chica] '}${formatComparison(c)}`);
      }
    } else {
      lines.push('DONDE MÁS PERDÉS');
      if (result.weakest.length === 0) lines.push('  (sin muestra suficiente todavía)');
      for (const c of result.weakest) lines.push(`  ${formatComparison(c)}`);
      lines.push('', 'DONDE ESTÁS MEJOR');
      if (result.strongest.length === 0) lines.push('  (sin muestra suficiente todavía)');
      for (const c of result.strongest) lines.push(`  ${formatComparison(c)}`);
    }

    lines.push('', ...result.notes.map((n) => `· ${n}`));
    return text(lines.join('\n'));
  },
);

// -------------------------------------------------------------- match detail

server.registerTool(
  'riot_match_detail',
  {
    title: 'Detalle de una partida',
    description:
      'Una partida completa desde la caché: los diez jugadores, y si hay timeline guardado, ' +
      'las diferencias de oro, CS y XP contra el rival de línea a los 10, 15 y 20 minutos.',
    inputSchema: {
      matchId: z.string().describe('ID de partida, ej. LA2_1234567890'),
      account: z.string().optional().describe('Cuenta desde cuya perspectiva mirar la partida'),
    },
  },
  async ({ matchId, account }) => {
    const match = getRawMatch(database(), matchId);
    if (!match) return text(`La partida ${matchId} no está en la caché. Corré riot_sync.`);

    const focusPuuid = account !== undefined ? requireAccount(account).puuid : null;
    const info = match.info;
    const minutes = info.gameDuration / 60;
    const lines = [
      `${matchId} — ${queueLabel(info.queueId)} — ${localTime(info.gameCreation)} — ${minutes.toFixed(1)} min`,
      '',
      'equipo  rol     campeón       KDA        CS   oro    daño    visión',
    ];

    for (const p of info.participants) {
      const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);
      const mark = p.puuid === focusPuuid ? '►' : ' ';
      lines.push(
        [
          `${mark}${p.teamId === 100 ? 'azul ' : 'rojo '}`.padEnd(8),
          (p.teamPosition || '—').toLowerCase().padEnd(7),
          p.championName.padEnd(13),
          `${p.kills}/${p.deaths}/${p.assists}`.padEnd(10),
          String(cs).padEnd(4),
          String(p.goldEarned).padEnd(6),
          String(p.totalDamageDealtToChampions).padEnd(7),
          String(p.visionScore),
        ].join(' '),
      );
    }

    const timeline = getRawTimeline(database(), matchId);
    if (timeline && focusPuuid !== null) {
      const me = info.participants.find((p) => p.puuid === focusPuuid);
      const opponent = info.participants.find(
        (p) => p.teamPosition === me?.teamPosition && p.teamId !== me?.teamId,
      );
      const idOf = (puuid: string): number | null => {
        const found = timeline.info.participants?.find((p) => p.puuid === puuid);
        if (found) return found.participantId;
        const index = match.metadata.participants.indexOf(puuid);
        return index >= 0 ? index + 1 : null;
      };
      const myId = idOf(focusPuuid);
      const oppId = opponent ? idOf(opponent.puuid) : null;

      if (myId !== null && oppId !== null) {
        lines.push('', `Diferencias contra ${opponent?.championName} (rival de línea):`, '');
        lines.push('minuto  oro     CS    XP');
        for (const target of [10, 15, 20]) {
          const frame = timeline.info.frames.find(
            (f) => Math.round(f.timestamp / 60000) === target,
          );
          if (!frame) continue;
          const a = frame.participantFrames[String(myId)];
          const b = frame.participantFrames[String(oppId)];
          if (!a || !b) continue;
          const gold = (a.totalGold ?? 0) - (b.totalGold ?? 0);
          const cs =
            (a.minionsKilled ?? 0) +
            (a.jungleMinionsKilled ?? 0) -
            ((b.minionsKilled ?? 0) + (b.jungleMinionsKilled ?? 0));
          const xp = (a.xp ?? 0) - (b.xp ?? 0);
          const sign = (n: number): string => (n >= 0 ? `+${n}` : String(n));
          lines.push(
            `${String(target).padEnd(7)} ${sign(gold).padEnd(7)} ${sign(cs).padEnd(5)} ${sign(xp)}`,
          );
        }
      }
    } else if (focusPuuid !== null) {
      lines.push(
        '',
        'Sin timeline guardado. Sincronizá con withTimeline para las curvas por minuto.',
      );
    }

    return text(lines.join('\n'));
  },
);

// -------------------------------------------------------------- cache status

server.registerTool(
  'riot_cache_status',
  {
    title: 'Estado de la caché',
    description: 'Qué hay bajado: partidas por cuenta y por cola, ventana temporal cubierta.',
    inputSchema: {},
  },
  async () => {
    const stats = cacheStats(database());
    if (stats.matches === 0) {
      return text('La caché está vacía. Empezá por riot_resolve_account y después riot_sync.');
    }
    const lines = [
      `${stats.matches} partidas · ${stats.participants} filas de jugador · ${stats.timelines} timelines`,
      '',
      'Por cuenta:',
    ];
    for (const a of stats.perAccount) {
      const window =
        a.oldest !== null && a.newest !== null
          ? `${localDate(a.oldest)} a ${localDate(a.newest)}`
          : 'sin partidas';
      lines.push(
        `  ${a.gameName}#${a.tagLine}${a.label ? ` (${a.label})` : ''}: ${a.matches} partidas, ${window}` +
          (a.lastSyncedAt !== null ? ` · último sync ${localTime(a.lastSyncedAt)}` : ''),
      );
    }
    lines.push('', 'Por cola:');
    for (const q of stats.perQueue) lines.push(`  ${queueLabel(q.queueId)}: ${q.matches}`);
    return text(lines.join('\n'));
  },
);

// ------------------------------------------------------------------ the engine

server.registerTool(
  'lol_prep',
  {
    title: 'Preparar un matchup',
    description:
      'Qué sabés de un matchup antes de jugarlo: tu récord en ESA cuenta, tus reps en todas, ' +
      'y el meta de op.gg — los tres por separado, con lo que la muestra permite afirmar.',
    inputSchema: {
      champion: z.string().describe('Tu campeón'),
      opponent: z.string().describe('El campeón rival de tu línea'),
      account: z.string().default('smurf').describe('Etiqueta o Riot ID de la cuenta'),
    },
  },
  async ({ champion, opponent, account }) => {
    const { puuid } = requireAccount(account);
    const record = listAccounts(database()).find((a) => a.puuid === puuid);
    const label = record?.label ?? record?.gameName ?? account;

    const rows = collectMatchups(database());
    // Resolve to the spellings the cache uses, so 'twisted fate' and 'TwistedFate' both work
    // (G-016). A raw comparison here once produced a fabricated vault-discrepancy report.
    const mine = rows.find((r) => sameChampion(r.champion, champion))?.champion ?? champion;
    const theirs = rows.find((r) => sameChampion(r.opponent, opponent))?.opponent ?? opponent;

    const prior = priorFor(loadPriors(), mine, theirs);
    const prep = prepMatchup(rows, { champion: mine, opponent: theirs, account: label, prior });
    const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');

    const lines = [
      `${mine} vs ${theirs} — cuenta ${label}`,
      `  reps totales (todas las cuentas): ${prep.repsTotal}`,
      `  en esta cuenta: ${prep.own.wins}/${prep.own.games}`,
    ];
    for (const other of prep.otherAccounts) {
      lines.push(
        `  en ${other.account}: ${other.wins}/${other.games} — NO se suma, es rendimiento`,
      );
    }
    lines.push(
      prior === null
        ? '  sin prior de op.gg'
        : `  meta op.gg: ${pct(prior.winRate)} sobre ${prior.sampleGames} partidas`,
    );
    for (const e of prep.estimates) {
      lines.push(`  estimado (peso ${e.weight}): ${pct(e.winRate)} · propio ${pct(e.ownWeight)}`);
    }
    lines.push(`  confianza: ${confidenceOf(prep)}`);
    return text(lines.join('\n'));
  },
);

server.registerTool(
  'lol_coverage',
  {
    title: 'Qué no sé todavía',
    description:
      'Los matchups sobre los que el motor no puede decir nada, y cuántas partidas faltan ' +
      'para que pueda. Las reps se suman entre cuentas, el récord no.',
    inputSchema: {
      account: z.string().default('smurf').describe('Etiqueta o Riot ID de la cuenta'),
      limit: z.number().int().min(1).max(40).default(10).describe('Cuántas filas devolver'),
    },
  },
  async ({ account, limit }) => {
    const { puuid } = requireAccount(account);
    const record = listAccounts(database()).find((a) => a.puuid === puuid);
    const label = record?.label ?? record?.gameName ?? account;

    const rows = collectMatchups(database());
    const priors = priorsKeyedLike(
      loadPriors(),
      rows.map((r) => ({ champion: r.champion, opponent: r.opponent })),
    );
    const coverage = coverageOf(rows, { account: label, priors });
    const totals = coverageTotals(rows, coverage);

    const lines = [
      `Cobertura — ${label}`,
      `  alcance: cola ${coverage.scope.queue}, remakes ${coverage.scope.remakes}, ` +
        `${coverage.scope.since === null ? 'toda la historia en caché' : 'ventana recortada'}`,
      `  ${totals.matchups} matchups · ${totals.reps} reps · ${totals.silent} mudos`,
      '',
    ];
    for (const row of coverage.rows.slice(0, limit)) {
      lines.push(
        `  ${row.champion} vs ${row.opponent}: ${row.ownGames} acá / ${row.reps} reps · ` +
          `${row.confidence}` +
          (row.gamesToNext === 0 ? '' : ` · faltan ${row.gamesToNext} para ${row.nextConfidence}`),
      );
    }
    return text(lines.join('\n'));
  },
);

server.registerTool(
  'lol_hypotheses',
  {
    title: 'El ledger de hipótesis',
    description:
      'Qué está registrado como predicción fechada, con qué spec congelada y cómo va contra ' +
      'las partidas posteriores. `insufficient_n` durante meses es la respuesta correcta.',
    inputSchema: {
      evaluate: z
        .boolean()
        .default(false)
        .describe('Correr la evaluación y APPENDEARLA al ledger, además de leer'),
    },
  },
  async ({ evaluate }) => {
    const live = listHypotheses(database());
    if (live.length === 0) return text('El ledger está vacío.');

    const measure = evaluate ? standardMeasure(database()) : null;
    const lines: string[] = [];
    for (const h of live) {
      lines.push(`${h.id} — ${h.claim}`);
      lines.push(
        `  spec ${h.specHash} · baseline ${h.baselineEffect.toFixed(3)} (n=${h.baselineN}) · ` +
          `necesita n=${h.nNeeded} · ${h.gapGames} en el hueco declarado`,
      );
      lines.push(`  cautela: ${h.caveat}`);
      // El asterisco: una fila que le mostramos antes de jugar ya no tiene ventana ciega.
      const exposicion = exposureOf(database(), h.id);
      if (exposicion !== null) {
        lines.push(
          `  EXPUESTA desde ${new Date(exposicion.first).toISOString().slice(0, 10)} · ` +
            `${gamesSince(database(), h.spec.puuid, exposicion.first)} partida(s) sabiéndola`,
        );
      }
      if (measure !== null) {
        // The spec is handed back explicitly so a drifted call site fails loudly (G-013).
        const e = evaluateHypothesis(database(), h.id, h.spec, measure);
        lines.push(
          `  fuera de muestra: n=${e.n}, efecto ` +
            `${Number.isFinite(e.effect) ? e.effect.toFixed(3) : 'no medible'} → ${e.verdict}`,
        );
      } else {
        const last = evaluationsOf(database(), h.id)[0];
        lines.push(
          last === undefined
            ? '  sin evaluar todavía'
            : `  última evaluación: ${last.verdict}, n=${last.n}`,
        );
      }
      lines.push('');
    }
    return text(lines.join('\n'));
  },
);

server.registerTool(
  'lol_tags',
  {
    title: 'Cómo se repartieron los resultados',
    description:
      'Las partidas tagueadas, separadas por a quién le atribuiste el resultado. Es un dato ' +
      'REPORTADO: sirve para separar poblaciones de derrota, nunca para explicarlas, y no ' +
      'existe el tag del rival contra el cual compararlo.',
    inputSchema: {
      account: z.string().default('smurf').describe('Etiqueta o Riot ID de la cuenta'),
    },
  },
  async ({ account }) => {
    const { puuid } = requireAccount(account);
    const rows = taggedRows(database(), puuid);
    const pending = untaggedGames(database(), puuid, { limit: 500 });
    const split = splitByTag(rows, pending.length);

    const lines = [
      `Tags — ${account}: ${split.tagged} tagueadas, ${split.untagged} sin taguear`,
      '',
    ];
    for (const p of split.populations) {
      const lag = Number.isFinite(p.medianLagMs)
        ? `${Math.round(p.medianLagMs / 60_000)} min de mediana desde el final de la partida`
        : 'sin medir';
      lines.push(`  ${p.tag}: ${p.wins}/${p.n} ganadas · ${lag}`);
    }
    lines.push('');
    lines.push('Las no tagueadas NO se reparten entre las demás: si tagueás según cómo salió,');
    lines.push('descartarlas en silencio haría que toda tasa de acá dependa de eso.');
    return text(lines.join('\n'));
  },
);

server.registerTool(
  'lol_tag',
  {
    title: 'Taguear una partida',
    description:
      'Atribuye el resultado de una partida: mía / igual / pareja. Lo normal es hacerlo con ' +
      '`lol cerrar` al terminar de jugar; esto existe para la noche que no lo corriste. ' +
      'Guarda CUÁNDO lo tagueaste y te dice el atraso, porque un tag de tres días es memoria.',
    inputSchema: {
      matchId: z.string().describe('Id de la partida, como LA2_1234567890'),
      tag: z.enum(['mía', 'igual', 'pareja']).describe('A quién le atribuís el resultado'),
      account: z.string().default('smurf').describe('Etiqueta o Riot ID de la cuenta'),
    },
  },
  async ({ matchId, tag, account }) => {
    const { puuid } = requireAccount(account);
    if (!TAGS.includes(tag as Tag)) throw new Error(`tag desconocido '${tag}'`);
    const now = Date.now();
    tagGame(database(), { matchId, puuid, tag: tag as Tag }, now);

    const stored = taggedRows(database(), puuid).find((r) => r.matchId === matchId);
    const lagMin = stored === undefined ? null : Math.round((now - stored.endedAt) / 60_000);
    return text(
      `${matchId} → ${tag}` +
        (lagMin === null
          ? ''
          : `\nAtraso: ${lagMin} min desde que terminó la partida.` +
            (lagMin > 12 * 60 ? ' Esto ya es memoria, no observación — queda anotado.' : '')),
    );
  },
);

server.registerTool(
  'lol_rank',
  {
    title: 'El reloj de rango',
    description:
      'Dónde está cada cuenta y qué se registró desde que el reloj arrancó. La serie es tan ' +
      'larga como la historia de haberla corrido: un rango no se reconstruye hacia atrás.',
    inputSchema: {
      account: z.string().default('smurf').describe('Etiqueta o Riot ID de la cuenta'),
    },
  },
  async ({ account }) => {
    const { puuid, label } = requireAccount(account);
    const lines = [`Rango — ${label}`];
    for (const queue of TRACKED_QUEUES) {
      const latest = latestSnapshot(database(), puuid, queue);
      if (latest === null) {
        lines.push(`  ${queue}: sin registros`);
        continue;
      }
      const history = snapshotHistory(database(), puuid, queue);
      lines.push(
        `  ${queue}: ${describeRank(latest)} (${latest.wins ?? 0}W-${latest.losses ?? 0}L) · ` +
          `${history.length} cambio(s) registrado(s) desde ${localDate(
            history[history.length - 1]?.observedAt ?? latest.observedAt,
          )}`,
      );
    }
    return text(lines.join('\n'));
  },
);

server.registerTool(
  'lol_antes',
  {
    title: 'El briefing de antes de jugar',
    description:
      'Lo que hay que arreglar antes de la sesión, UN foco sacado del ledger y el reloj. ' +
      'Anota lo que muestra: mostrar una hipótesis viva la contamina a propósito, y desde ' +
      'cuándo la sabe tiene que quedar registrado (ADR-022).',
    inputSchema: {
      account: z.string().describe('Etiqueta, Riot ID o nombre de la cuenta que va a jugar'),
    },
  },
  async ({ account }) => {
    let briefing: ReturnType<typeof assembleBriefing>;
    try {
      briefing = assembleBriefing(database(), account);
    } catch (error) {
      if (error instanceof PregameError) return text(error.message);
      throw error;
    }

    const lines: string[] = [`Antes de jugar — cuenta ${briefing.account}`, ''];

    lines.push('PISTA LIBRE');
    if (briefing.runway.length === 0) lines.push('  Nada que arreglar.');
    for (const a of briefing.runway) lines.push(`  [${a.urgencia}] ${a.que} — ${a.porque}`);
    lines.push('');

    lines.push('EL FOCO');
    if (briefing.focus === null) {
      lines.push(`  ${briefing.noFocusReason ?? 'Nada registrado que mostrar.'}`);
    } else {
      lines.push(`  ${briefing.focus.id} — ${briefing.focus.claim}`);
      lines.push(`  cautela: ${briefing.focus.caveat}`);
      lines.push(`  le faltan ${briefing.focus.shortfall} mediciones · ${briefing.focus.why}`);
    }
    for (const w of briefing.withheld) {
      lines.push(
        w.reason === 'sin_evaluar'
          ? `  GUARDADA: ${w.id} (nunca evaluada: no se sabe cuánto acumuló)`
          : `  GUARDADA: ${w.id} (le faltan ${w.shortfall}, todavía puede dar veredicto)`,
      );
    }
    lines.push('');

    lines.push('EL RELOJ');
    for (const r of briefing.clock) {
      const wl = r.wins === null || r.losses === null ? '' : ` (${r.wins}W-${r.losses}L)`;
      lines.push(`  ${r.queue}: ${r.text}${wl}`);
    }

    if (briefing.silence !== null) {
      lines.push('');
      lines.push(
        `NO PUEDO HABLAR de ${briefing.silence.muted} de ${briefing.silence.total} matchups ` +
          'todavía. En champ select, pedime lol_prep del que le toque.',
      );
    }
    return text(lines.join('\n'));
  },
);

// -------------------------------------------------------------------- start

const transport = new StdioServerTransport();
await server.connect(transport);
