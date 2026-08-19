import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Accion, type Briefing, runway } from '../analysis/briefing.ts';
import {
  abandonedByCutoff,
  closeSession,
  getTagCutoff,
  openSession,
  setTagCutoff,
  TAGS,
  type Tag,
  tagGame,
  tagOf,
  untaggedGames,
} from '../analysis/capture.ts';
import { coverageOf, coverageTotals } from '../analysis/coverage.ts';
import { stateCurve } from '../analysis/curve.ts';
import { evaluationsOf, listHypotheses } from '../analysis/hypotheses.ts';
import { itemRace } from '../analysis/items.ts';
import { collectMatchups } from '../analysis/matchups.ts';
import { deathsOf, describeDeath, expensiveMoments } from '../analysis/moments.ts';
import { sameChampion } from '../analysis/names.ts';
import { confidenceOf, prepMatchup } from '../analysis/prep.ts';
import { loadPriors, priorFor, priorsKeyedLike } from '../analysis/priors.ts';
import { describeRank, latestSnapshot, TRACKED_QUEUES } from '../analysis/rank.ts';
import { type DeathDot, deathMapSvg, goldCurveSvg, isOwnHalf } from '../analysis/render.ts';
import { assembleBriefing, PregameError } from '../pregame.ts';
import { KeyError, keyState, writeKey } from '../riot/key.ts';
import type { Db } from '../store/db.ts';
import { ASSETS_ROOT } from '../store/db.ts';
import { catalogForPatch } from '../store/items.ts';
import {
  findAccount,
  getRawMatch,
  getRawTimeline,
  lastSync,
  listAccounts,
  queryParticipants,
} from '../store/matches.ts';
import { type Upkeep, upkeepState } from '../upkeep.ts';

/**
 * The UI's handlers, as functions over `Db` rather than over an HTTP request.
 *
 * The split is the point: everything worth testing lives here and is exercised against an
 * in-memory database like the rest of the project, while `server.ts` stays thin enough that
 * there is nothing in it to get wrong. It is the same shape `src/cli/*` has over the same
 * analysis layer — a third front-end, not a third copy of the engine (ADR-006).
 */

/**
 * A thing he could do right now, and why. The answer to "decime qué tengo que ejecutar".
 *
 * The type and the rules that build it live in `analysis/briefing.ts` now: the pre-game moment
 * needs the same list under a different framing, and two copies of "what is broken" drift the
 * day one of them learns about a new failure.
 */
export type { Accion };

export type EstadoCuenta = {
  label: string;
  puuid: string;
  pendientes: number;
  /** Untagged games the cutoff decision left behind. Reported, never silently dropped. */
  dejadasAtras: number;
  ultimoSync: { at: number; terminado: boolean; fetched: number; error: string | null } | null;
  rango: { cola: string; texto: string; wins: number | null; losses: number | null }[];
};

export type EstadoKey = {
  presente: boolean;
  tipo: string;
  horasDesdeQueSePego: number | null;
  probablementeVencida: boolean;
  problema: string | null;
  archivo: string;
};

export type Estado = {
  cuentas: EstadoCuenta[];
  key: EstadoKey;
  pendientesTotal: number;
  /** The dated decision, or null while every game is still askable. */
  corteDeTagueo: { at: number; setAt: number; dejadasAtras: number } | null;
  acciones: Accion[];
};

/**
 * Everything the status panel needs, and NOT ONE REQUEST to Riot.
 *
 * That property is deliberate and load-bearing: the page polls this on a timer, so if it cost
 * requests the panel would quietly eat the 100-per-2-minutes budget that the actual sync needs.
 */
export function estado(db: Db, now: number = Date.now()): Estado {
  const key = keyState(new Date(now));
  const corte = getTagCutoff(db);
  const cuentas: EstadoCuenta[] = [];

  for (const account of listAccounts(db)) {
    const pendientes = untaggedGames(db, account.puuid, { limit: 500 }).length;
    const sync = lastSync(db, account.puuid);
    cuentas.push({
      label: account.label ?? account.gameName,
      puuid: account.puuid,
      pendientes,
      dejadasAtras: abandonedByCutoff(db, account.puuid),
      ultimoSync:
        sync === null
          ? null
          : {
              at: sync.startedAt,
              terminado: sync.finishedAt !== null,
              fetched: sync.fetched,
              error: sync.error,
            },
      rango: TRACKED_QUEUES.map((cola) => {
        const snapshot = latestSnapshot(db, account.puuid, cola);
        return {
          cola,
          texto: describeRank(snapshot),
          wins: snapshot?.wins ?? null,
          losses: snapshot?.losses ?? null,
        };
      }),
    });
  }

  const pendientesTotal = cuentas.reduce((n, c) => n + c.pendientes, 0);

  // ONE implementation of "what is broken", shared with the pre-game briefing (ADR-022). The
  // panel reads it as "qué hacer ahora" and `lol antes` reads it as "qué te va a romper el
  // ritual de esta noche"; they are two framings of one list, and keeping two copies is how the
  // day-after list learns about a failure the night-before list never hears of.
  const acciones = runway({
    cuentas: cuentas.map((c) => ({
      pendientes: c.pendientes,
      ultimoSyncAt: c.ultimoSync?.at ?? null,
    })),
    key: {
      presente: key.present,
      probablementeVencida: key.likelyExpired,
      problema: key.problem,
    },
    now,
  });

  return {
    cuentas,
    // Note what is NOT here: `masked`. `keyState` returns a first-and-last-four version that is
    // safe by construction, and it still does not travel — the panel can be fully useful without
    // any part of the value ever reaching a browser, a devtools tab or a screenshot (G-002).
    key: {
      presente: key.present,
      tipo: key.kind,
      horasDesdeQueSePego: key.hoursSinceUpdate,
      probablementeVencida: key.likelyExpired,
      problema: key.problem,
      archivo: key.envPath,
    },
    pendientesTotal,
    corteDeTagueo:
      corte === null
        ? null
        : {
            at: corte.at,
            setAt: corte.setAt,
            dejadasAtras: cuentas.reduce((n, c) => n + c.dejadasAtras, 0),
          },
    acciones,
  };
}

// ------------------------------------------------------------------------ la captura

export class RouteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function cuentaDe(db: Db, needle: string): { puuid: string; label: string } {
  const found = findAccount(db, needle);
  if (found === null) throw new RouteError(404, `no conozco la cuenta '${needle}'`);
  return { puuid: found.puuid, label: found.label ?? found.gameName };
}

export type Pendiente = {
  matchId: string;
  terminoAt: number;
  gano: boolean;
  campeon: string;
};

/**
 * How far back a game still counts as "the session he just played".
 *
 * Presentational, and it has to stay that way: it decides what the page shows first and enters no
 * number anywhere. The lag that actually matters is recorded per tag from the game's end
 * (ADR-015), so nothing downstream depends on where this line sits.
 */
export const VENTANA_SESION_MS = 12 * 3_600_000;

/**
 * The games still waiting for a tag, OLDEST FIRST, split into tonight's and the backlog.
 *
 * The order is not cosmetic and it is the same one `lol cerrar` uses: he replays the session in
 * the order he lived it, which is the order he remembers it in. `untaggedGames` returns newest
 * first because every other consumer wants that.
 *
 * THE SPLIT EXISTS FOR TWO REASONS, and the second is the real one. A first run has every game he
 * has ever played sitting untagged — seventy of them in a seeded corpus — which renders as a wall
 * that pushes the rest of the page out of sight. But more than that: tagging a two-week-old game
 * is recall, not observation, and ADR-015 built the lag column precisely because those are not
 * the same measurement. Showing them together invites him to fill in a backlog from memory and
 * file it beside tonight's games as if it were the same thing.
 */
export function pendientes(
  db: Db,
  cuenta: string,
  now: number = Date.now(),
): { cuenta: string; deLaSesion: Pendiente[]; atrasadas: Pendiente[] } {
  const { puuid, label } = cuentaDe(db, cuenta);
  const todas = untaggedGames(db, puuid, { limit: 200 })
    .map((g) => ({
      matchId: g.matchId,
      terminoAt: g.endedAt,
      gano: g.win,
      campeon: g.champion,
    }))
    .reverse();

  return {
    cuenta: label,
    deLaSesion: todas.filter((p) => now - p.terminoAt <= VENTANA_SESION_MS),
    atrasadas: todas.filter((p) => now - p.terminoAt > VENTANA_SESION_MS),
  };
}

/**
 * Takes the decision to stop asking about everything played so far.
 *
 * It writes a DATE, not a deletion: the games stay in the cache, `abandonedByCutoff` keeps
 * counting them, and any analysis that wants the whole backlog can still ask for it. What
 * changes is what the panel demands of him, which is the thing that was wrong — a hundred games
 * he does not remember cannot be tagged honestly, and an urgent action that can never be
 * completed trains him to ignore the urgent actions that can.
 */
export function dejarAtras(
  db: Db,
  now: number = Date.now(),
): { corte: number; dejadasAtras: number } {
  const cutoff = setTagCutoff(db, now, now);
  let dejadas = 0;
  for (const account of listAccounts(db)) dejadas += abandonedByCutoff(db, account.puuid);
  return { corte: cutoff.at, dejadasAtras: dejadas };
}

/**
 * Records ONE tag.
 *
 * One game per request, on purpose. The browser must never collect the session's tags and post
 * them at the end: closing the tab after three clicks has to leave three tags in the database.
 * That is the same guarantee `lol cerrar` gives by committing inside its loop (ADR-016), and it
 * is the reason this endpoint is deliberately not a batch one.
 */
export function taguear(
  db: Db,
  input: { cuenta: string; matchId: string; tag: string; sesion?: number | null },
  now: number = Date.now(),
): { ok: true; tag: Tag; atrasoMs: number } {
  const { puuid } = cuentaDe(db, input.cuenta);
  if (!TAGS.includes(input.tag as Tag)) {
    throw new RouteError(400, `tag desconocido '${input.tag}' — esperaba ${TAGS.join(' | ')}`);
  }
  const tag = input.tag as Tag;
  tagGame(db, { matchId: input.matchId, puuid, tag, sessionId: input.sesion ?? null }, now);

  // The lag travels back so the page can show it. A tag typed twenty minutes after the game is
  // observation; one typed on Thursday about Monday is memory, and the reader has to be able to
  // tell them apart (ADR-015).
  const row = db
    .prepare(
      `SELECT m.game_creation + m.game_duration * 1000 AS ended_at
         FROM matches m WHERE m.match_id = ?`,
    )
    .get(input.matchId) as { ended_at: number } | undefined;
  return { ok: true, tag, atrasoMs: row === undefined ? Number.NaN : now - Number(row.ended_at) };
}

export function abrirSesion(db: Db, cuenta: string, now: number = Date.now()): { sesion: number } {
  const { puuid } = cuentaDe(db, cuenta);
  return { sesion: openSession(db, puuid, now) };
}

/**
 * Closes the sitting, with the tilt if he gave one.
 *
 * `tilt` is `number | null` and never absent: "he declined to answer" and "the page forgot to
 * ask" have to store the same thing, and it must not be a middling 3 (G-005).
 */
export function cerrarSesion(
  db: Db,
  input: { sesion: number; tilt: number | null },
  now: number = Date.now(),
): { ok: true } {
  closeSession(db, input.sesion, input.tilt, now);
  return { ok: true };
}

// ------------------------------------------------------------------------ el sync

/**
 * One sync at a time, process-wide.
 *
 * Two concurrent syncs would each hold their own rate limiter and between them could exceed the
 * 100-requests-per-2-minutes budget, which Riot answers with 429s that look like a broken key.
 * A double-click on the button must not be able to cause that.
 *
 * THE LIMIT THIS DOES NOT FIX, stated rather than papered over: the MCP server is a SEPARATE
 * PROCESS with its own limiter, so `riot_sync` running at the same time as this can still blow
 * the budget between them. The correct answer for a one-user tool is not to run both at once,
 * not to invent shared-limiter machinery for a problem that has a one-line habit as its cure.
 */
let corriendo = false;

export function syncEnCurso(): boolean {
  return corriendo;
}

export type SyncEvento =
  | { tipo: 'inicio'; cuenta: string }
  | { tipo: 'progreso'; hechas: number; total: number }
  /** Un paso de la cadena posterior al sync: catálogos, imágenes, ledger. */
  | { tipo: 'paso'; que: string; detalle: string }
  | { tipo: 'fin'; bajadas: number; timelines: number; remakes: number; errores: string[] }
  | { tipo: 'error'; mensaje: string };

/**
 * Una tarea suelta de puesta al día. Distinta de `SyncEvento` a propósito: comparten el canal
 * pero no el vocabulario, y un `fin` de sync trae números que una tarea no tiene.
 */
export type TareaEvento =
  | { tipo: 'inicio'; cuenta: string }
  | { tipo: 'progreso'; hechas: number; total: number; detalle: string }
  | { tipo: 'listo'; detalle: string }
  | { tipo: 'error'; mensaje: string };

/**
 * Runs a sync, reporting progress as it goes.
 *
 * Streamed rather than returned because a sync with timelines moves at roughly 25 games a
 * minute: a request that answers only at the end would sit silent for minutes and look hung.
 * `syncMatches` already accepts an `onProgress`, so the stream is built out of what exists.
 */
export async function sincronizar(
  db: Db,
  cuenta: string,
  emit: (evento: SyncEvento) => void,
  deps: {
    sync: (
      puuid: string,
      onProgress: (done: number, total: number) => void,
    ) => Promise<{
      fetched: number;
      timelines: number;
      remakes: number;
      errors: string[];
    }>;
    rango?: () => Promise<void>;
    /**
     * Lo que antes eran tres comandos de terminal. Corre DESPUÉS de bajar las partidas y recibe
     * si hubo alguna nueva, porque evaluar el ledger sin partidas nuevas solo agrega una fila
     * idéntica.
     */
    tareas?: (
      huboPartidasNuevas: boolean,
      paso: (que: string, detalle: string) => void,
    ) => Promise<void>;
  },
): Promise<void> {
  if (corriendo) throw new RouteError(409, 'ya hay un sync corriendo');
  const { puuid, label } = cuentaDe(db, cuenta);
  corriendo = true;
  try {
    emit({ tipo: 'inicio', cuenta: label });
    const result = await deps.sync(puuid, (hechas, total) =>
      emit({ tipo: 'progreso', hechas, total }),
    );
    // The rank clock is a nice-to-have and the sync is not: a failure here must not turn a
    // successful sync into a reported failure.
    if (deps.rango) {
      try {
        await deps.rango();
      } catch {
        /* the clock simply does not advance today */
      }
    }
    // New games mean a new map. Dropped here rather than left to expire, so the page redrawing
    // after a sync shows the games that sync just brought in.
    olvidarMapa();

    // La cadena que hace que no haya que correr nada a mano. Va envuelta por lo mismo que el
    // reloj de rango: son mejoras sobre un sync que YA salió bien, y un fallo bajando un ícono
    // no puede convertir una sincronización exitosa en una fallida.
    if (deps.tareas) {
      try {
        await deps.tareas(result.fetched > 0, (que, detalle) =>
          emit({ tipo: 'paso', que, detalle }),
        );
      } catch (error) {
        emit({
          tipo: 'paso',
          que: 'puesta al día',
          detalle: `quedó a medias: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    emit({
      tipo: 'fin',
      bajadas: result.fetched,
      timelines: result.timelines,
      remakes: result.remakes,
      errores: result.errors,
    });
  } catch (error) {
    emit({ tipo: 'error', mensaje: error instanceof Error ? error.message : String(error) });
  } finally {
    // In `finally` on purpose: an early return or a throw that left this true would wedge the
    // button for the rest of the process's life, with no way back but a restart.
    corriendo = false;
  }
}

// ------------------------------------------------------------------------ lectura

export type MomentoPartida = {
  matchId: string;
  at: number;
  campeon: string;
  rival: string | null;
  gano: boolean;
  tag: string | null;
  momentos: { minuto: string; linea: string; oro: number }[];
  /** The build, his against his lane opponent's. `null` when the patch has no catalogue cached.
   *  The item ID travels so the page can show the icon; the name travels beside it so a missing
   *  picture degrades to text instead of to a blank square. */
  items: {
    mios: { id: number; nombre: string; min: string }[];
    suyos: { id: number; nombre: string; min: string }[];
    primerItemMin: number | null;
  } | null;
  sinMedir: number;
  sinTimeline: boolean;
};

/**
 * The headline output, unchanged in substance from `lol report`: the three most expensive
 * moments of each recent game, with the exact minute to scrub a replay to.
 *
 * This stays the top of the page on purpose. ADR-007 banned a dashboard of aggregates REPLACING
 * this, and the ban still holds — the UI adds execution, it does not promote averages.
 */
export function momentos(db: Db, cuenta: string, limite = 5): MomentoPartida[] {
  const { puuid } = cuentaDe(db, cuenta);
  const rows = queryParticipants(db, { puuid, role: 'MIDDLE', queueId: 420, limit: limite });
  const out: MomentoPartida[] = [];

  for (const row of rows) {
    const match = getRawMatch(db, row.matchId);
    const timeline = getRawTimeline(db, row.matchId);
    const me = match?.info.participants.find((p) => p.puuid === puuid);
    const rival =
      match === null || me === undefined
        ? null
        : (match.info.participants.find(
            (p) => p.teamPosition === me.teamPosition && p.teamId !== me.teamId,
          )?.championName ?? null);

    if (match === null || timeline === null) {
      out.push({
        matchId: row.matchId,
        at: row.gameCreation,
        campeon: row.champion,
        rival,
        gano: row.win === 1,
        tag: tagOf(db, row.matchId, puuid),
        momentos: [],
        items: null,
        sinMedir: 0,
        sinTimeline: true,
      });
      continue;
    }

    const { moments, unmeasurable } = expensiveMoments(match, timeline, puuid, 3);
    // No catalogue for that patch means no item line, never another patch's build paths.
    const catalog = catalogForPatch(db, row.patch ?? '');
    const race = catalog === null ? null : itemRace(match, timeline, puuid, catalog);
    out.push({
      matchId: row.matchId,
      at: row.gameCreation,
      campeon: row.champion,
      rival,
      gano: row.win === 1,
      tag: tagOf(db, row.matchId, puuid),
      momentos: moments.map((m) => ({ minuto: m.at, linea: m.line, oro: m.costGold })),
      items:
        race === null
          ? null
          : {
              mios: race.mine.map((c) => ({ id: c.itemId, nombre: c.name, min: c.at })),
              suyos: race.theirs.map((c) => ({ id: c.itemId, nombre: c.name, min: c.at })),
              primerItemMin: race.firstGapMinutes,
            },
      sinMedir: unmeasurable,
      sinTimeline: false,
    });
  }
  return out;
}

export type Graficos = {
  curva: string | null;
  mapa: string;
  muertes: number;
  propiaMitad: number;
  partidas: number;
};

/**
 * Memoised, because the death map reads EVERY cached game.
 *
 * Measured before adding this, over 70 seeded games with 6.4 MB of timelines: 40 ms per call,
 * against 1 ms for the status panel and 6 ms for the moments. His real timelines are roughly
 * thirty times larger per game, which puts a real page load near 1.2 s of a single-threaded
 * server doing nothing else. Not the catastrophe it looked like from reading the code, and still
 * worth removing: it is paid on every load and again after every sync.
 *
 * Safe to cache at all because finished games are immutable (ADR-004), so the answer only
 * changes when the cache gains something.
 */
let mapaCache: { clave: string; valor: Graficos } | null = null;

/**
 * What has to change for the drawing to change.
 *
 * Three parts, and the third is the one that is easy to forget: a timeline BACKFILL adds deaths
 * to games that are already in the cache without touching the game count or the newest id, so a
 * key built from those two alone would serve a stale map forever after a backfill — which is
 * exactly the operation that produced the timelines in the first place.
 */
function claveDelMapa(db: Db, puuid: string): string {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS partidas,
              COALESCE(MAX(m.game_creation), 0) AS ultima,
              SUM(CASE WHEN t.match_id IS NULL THEN 0 ELSE 1 END) AS timelines
         FROM participants p
         JOIN matches m ON m.match_id = p.match_id
         LEFT JOIN timelines t ON t.match_id = p.match_id
        WHERE p.puuid = ?`,
    )
    .get(puuid) as Record<string, unknown>;
  return [puuid, row['partidas'], row['ultima'], row['timelines']].join('|');
}

/** Drops the memo. Called after a sync, so the page does not have to know the cache exists. */
export function olvidarMapa(): void {
  mapaCache = null;
}

/** The two things text does badly (ADR-007), rendered by the SVG builders that already exist. */
export function graficos(db: Db, cuenta: string, limite = 10): Graficos {
  const { puuid } = cuentaDe(db, cuenta);
  const clave = claveDelMapa(db, puuid);
  if (mapaCache !== null && mapaCache.clave === clave) return mapaCache.valor;
  const recientes = queryParticipants(db, { puuid, role: 'MIDDLE', queueId: 420, limit: limite });
  const todas = queryParticipants(db, { puuid, role: 'MIDDLE', queueId: 420 });

  let curva: string | null = null;
  for (const row of recientes) {
    const match = getRawMatch(db, row.matchId);
    const timeline = getRawTimeline(db, row.matchId);
    if (match === null || timeline === null) continue;
    const c = stateCurve(match, timeline, puuid);
    if (c.points.length > 0) {
      curva = goldCurveSvg(c.points);
      break;
    }
  }

  const dots: DeathDot[] = [];
  let conTimeline = 0;
  for (const row of todas) {
    const match = getRawMatch(db, row.matchId);
    const timeline = getRawTimeline(db, row.matchId);
    if (match === null || timeline === null) continue;
    conTimeline += 1;
    for (const death of deathsOf(match, timeline, puuid)) {
      if (death.position === null) continue;
      dots.push({
        position: death.position,
        // Per game, because which half is "his" depends on the side he was on THAT game —
        // Summoner's Rift lanes are absolute and shared, so this is computed, never mirrored
        // (ADR-014).
        teamId: row.teamId,
        minute: Math.floor(death.timestamp / 60_000),
        costGold: death.costGold,
        label: describeDeath(death),
      });
    }
  }

  const valor: Graficos = {
    curva,
    // The photograph only goes in when it is actually on disk: a broken <image> inside the SVG
    // would draw nothing and look like the black-square bug all over again (G-023).
    mapa: deathMapSvg(
      dots,
      520,
      existsSync(join(ASSETS_ROOT, 'map', 'map11.png')) ? '/img/map/map11.png' : null,
    ),
    muertes: dots.length,
    propiaMitad: dots.filter((d) => isOwnHalf(d.position, d.teamId)).length,
    partidas: conTimeline,
  };
  mapaCache = { clave, valor };
  return valor;
}

export function cobertura(
  db: Db,
  cuenta: string,
  limite = 12,
): {
  alcance: { cuenta: string; cola: string; desde: number | null; remakes: string };
  totales: { matchups: number; reps: number; mudos: number };
  filas: {
    campeon: string;
    rival: string;
    propias: number;
    reps: number;
    confianza: string;
    faltan: number;
    siguiente: string | null;
  }[];
} {
  const { label } = cuentaDe(db, cuenta);
  const rows = collectMatchups(db);
  const priors = priorsKeyedLike(
    loadPriors(),
    rows.map((r) => ({ champion: r.champion, opponent: r.opponent })),
  );
  const c = coverageOf(rows, { account: label, priors });
  const totales = coverageTotals(rows, c);
  return {
    alcance: {
      cuenta: c.scope.account,
      cola: c.scope.queue,
      desde: c.scope.since,
      remakes: c.scope.remakes,
    },
    totales: { matchups: totales.matchups, reps: totales.reps, mudos: totales.silent },
    filas: c.rows.slice(0, limite).map((r) => ({
      campeon: r.champion,
      rival: r.opponent,
      propias: r.ownGames,
      reps: r.reps,
      confianza: r.confidence,
      faltan: r.gamesToNext,
      siguiente: r.nextConfidence,
    })),
  };
}

export function prep(
  db: Db,
  cuenta: string,
  campeon: string,
  rival: string,
): {
  campeon: string;
  rival: string;
  reps: number;
  propias: { ganadas: number; jugadas: number };
  otrasCuentas: { cuenta: string; ganadas: number; jugadas: number }[];
  meta: { winRate: number; muestra: number } | null;
  estimados: { peso: number; winRate: number; propio: number }[];
  confianza: string;
} {
  const { label } = cuentaDe(db, cuenta);
  const rows = collectMatchups(db);
  // Resolve to the spellings the cache uses so 'twisted fate' and 'TwistedFate' both work; a
  // raw comparison here once manufactured a whole false discrepancy report (G-016).
  const mio = rows.find((r) => sameChampion(r.champion, campeon))?.champion ?? campeon;
  const suyo = rows.find((r) => sameChampion(r.opponent, rival))?.opponent ?? rival;
  const prior = priorFor(loadPriors(), mio, suyo);
  const p = prepMatchup(rows, { champion: mio, opponent: suyo, account: label, prior });

  return {
    campeon: mio,
    rival: suyo,
    reps: p.repsTotal,
    propias: { ganadas: p.own.wins, jugadas: p.own.games },
    otrasCuentas: p.otherAccounts.map((o) => ({
      cuenta: o.account,
      ganadas: o.wins,
      jugadas: o.games,
    })),
    meta: prior === null ? null : { winRate: prior.winRate, muestra: prior.sampleGames },
    estimados: p.estimates.map((e) => ({
      peso: e.weight,
      winRate: e.winRate,
      propio: e.ownWeight,
    })),
    confianza: confidenceOf(p),
  };
}

export function ledger(db: Db): {
  id: string;
  claim: string;
  baseline: number;
  baselineN: number;
  necesita: number;
  cautela: string;
  ultima: { veredicto: string; n: number } | null;
}[] {
  return listHypotheses(db).map((h) => {
    const last = evaluationsOf(db, h.id)[0];
    return {
      id: h.id,
      claim: h.claim,
      baseline: h.baselineEffect,
      baselineN: h.baselineN,
      necesita: h.nNeeded,
      cautela: h.caveat,
      ultima: last === undefined ? null : { veredicto: last.verdict, n: last.n },
    };
  });
}

// ------------------------------------------------------------------------ antes de jugar

/**
 * El briefing previo a la sesión, y la anotación de lo que le mostró.
 *
 * Ojo con lo que hace de más respecto a las demás rutas: ESCRIBE. Una exposición se anota cuando
 * el foco se muestra, porque la contaminación empieza cuando la lee, no cuando la usa. Que el
 * panel se abra después de jugar y también anote es el error en la dirección correcta: sobrestima
 * la contaminación, y sobrestimarla nunca deja pasar un veredicto sucio como limpio.
 *
 * `SESSION_GAP_MS` hace que el polling de la página no infle el conteo: una fila de la tabla es
 * una sentada, no un refresh.
 */
export function antes(db: Db, cuenta: string, now: number = Date.now()): Briefing {
  try {
    return assembleBriefing(db, cuenta, now);
  } catch (error) {
    if (error instanceof PregameError) throw new RouteError(404, error.message);
    throw error;
  }
}

// ------------------------------------------------------------------------ puesta al día

/** Qué está al día y qué no. Consulta local: no baja nada y no gasta un solo request. */
export function upkeep(db: Db): Upkeep {
  return upkeepState(db);
}

/**
 * Guarda una key nueva desde el panel. Devuelve el estado, NUNCA el valor (G-002).
 *
 * Es un POST y no un GET a propósito: una query string queda en el log del servidor, en el
 * historial del navegador y en cualquier captura de la barra de direcciones. El cuerpo de un POST
 * no.
 */
export function guardarKey(valor: string, now: number = Date.now()): EstadoKey {
  try {
    writeKey(valor);
  } catch (error) {
    if (error instanceof KeyError) throw new RouteError(400, error.message);
    throw error;
  }
  const key = keyState(new Date(now));
  return {
    presente: key.present,
    tipo: key.kind,
    horasDesdeQueSePego: key.hoursSinceUpdate,
    probablementeVencida: key.likelyExpired,
    problema: key.problem,
    archivo: key.envPath,
  };
}
