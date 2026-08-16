import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { benchmark, formatComparison, mostPlayedRole } from './analysis/benchmark.ts';
import { normaliseRole, type Role, roleLabel } from './analysis/metrics.ts';
import { createClient } from './riot/client.ts';
import { keyState } from './riot/key.ts';
import { platformLabel } from './riot/routing.ts';
import { QUEUE, type QueueName, queueLabel } from './riot/types.ts';
import { type Db, openDb } from './store/db.ts';
import {
  cacheStats,
  findAccount,
  getRawMatch,
  getRawTimeline,
  listAccounts,
  queryParticipants,
} from './store/matches.ts';
import { resolveAccount, syncMatches } from './sync.ts';

/**
 * MCP server. Registers the seven tools and talks JSON-RPC over stdio.
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

const server = new McpServer({ name: 'riot-mcp', version: '0.1.0' });

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
      const sorted = [...result.comparisons].sort((a, b) => a.effect - b.effect);
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

// -------------------------------------------------------------------- start

const transport = new StdioServerTransport();
await server.connect(transport);
