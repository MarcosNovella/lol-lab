import {
  closeSession,
  openSession,
  TAGS,
  type Tag,
  tagGame,
  untaggedGames,
} from '../analysis/capture.ts';
import { describeRank, latestSnapshot, TRACKED_QUEUES } from '../analysis/rank.ts';
import { keyState } from '../riot/key.ts';
import type { Db } from '../store/db.ts';
import { findAccount, lastSync, listAccounts } from '../store/matches.ts';

/**
 * The UI's handlers, as functions over `Db` rather than over an HTTP request.
 *
 * The split is the point: everything worth testing lives here and is exercised against an
 * in-memory database like the rest of the project, while `server.ts` stays thin enough that
 * there is nothing in it to get wrong. It is the same shape `src/cli/*` has over the same
 * analysis layer — a third front-end, not a third copy of the engine (ADR-006).
 */

/** A thing he could do right now, and why. The answer to "decime qué tengo que ejecutar". */
export type Accion = {
  /** Stable id so the page can wire a button to it without matching on prose. */
  id: 'taguear' | 'sync' | 'key' | 'resolver_cuenta';
  urgencia: 'ahora' | 'cuando_puedas';
  que: string;
  porque: string;
};

export type EstadoCuenta = {
  label: string;
  puuid: string;
  pendientes: number;
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
  const cuentas: EstadoCuenta[] = [];

  for (const account of listAccounts(db)) {
    const pendientes = untaggedGames(db, account.puuid, { limit: 500 }).length;
    const sync = lastSync(db, account.puuid);
    cuentas.push({
      label: account.label ?? account.gameName,
      puuid: account.puuid,
      pendientes,
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
  const acciones: Accion[] = [];

  if (cuentas.length === 0) {
    acciones.push({
      id: 'resolver_cuenta',
      urgencia: 'ahora',
      que: 'Registrar tu cuenta',
      porque: 'La caché está vacía: no hay ninguna cuenta resuelta todavía.',
    });
  }

  // Tagging comes first in the list for the same reason it comes first in the ritual: it is the
  // only input here that cannot be recomputed tomorrow (ADR-015).
  if (pendientesTotal > 0) {
    acciones.push({
      id: 'taguear',
      urgencia: 'ahora',
      que: `Taguear ${pendientesTotal} partida${pendientesTotal === 1 ? '' : 's'}`,
      porque:
        'Es lo único que separa "jugué mal" de "me tocó mal", y una partida sin taguear no se ' +
        'puede taguear más adelante.',
    });
  }

  if (!key.present || key.likelyExpired) {
    acciones.push({
      id: 'key',
      urgencia: key.present ? 'cuando_puedas' : 'ahora',
      que: key.present ? 'Regenerar la key de Riot' : 'Pegar una key de Riot',
      porque: key.problem ?? 'Sin key no se puede sincronizar.',
    });
  }

  // "Never synced" and "synced a long time ago" are different facts and must not collapse into
  // each other. Mapping a missing sync to 0 makes `now - 0` an age of five hundred thousand
  // hours, which is a plausible-looking number standing in for an absent one — the substitution
  // G-005 exists to stop.
  const nuncaSincronizada = cuentas.some((c) => c.ultimoSync === null);
  const sincronizadas = cuentas.flatMap((c) => (c.ultimoSync === null ? [] : [c.ultimoSync.at]));
  const masVieja = sincronizadas.length === 0 ? null : Math.min(...sincronizadas);
  const horasSinSync = masVieja === null ? null : (now - masVieja) / 3_600_000;

  if (cuentas.length > 0 && (nuncaSincronizada || (horasSinSync !== null && horasSinSync >= 12))) {
    acciones.push({
      id: 'sync',
      urgencia: 'cuando_puedas',
      que: 'Sincronizar',
      porque: nuncaSincronizada
        ? 'Hay una cuenta que nunca se sincronizó.'
        : `Hace ${Math.floor(horasSinSync ?? 0)} h que no se baja nada.`,
    });
  }

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
 * The games still waiting for a tag, OLDEST FIRST.
 *
 * The order is not cosmetic and it is the same one `lol cerrar` uses: he replays the session in
 * the order he lived it, which is the order he remembers it in. `untaggedGames` returns newest
 * first because every other consumer wants that.
 */
export function pendientes(db: Db, cuenta: string): { cuenta: string; partidas: Pendiente[] } {
  const { puuid, label } = cuentaDe(db, cuenta);
  const partidas = untaggedGames(db, puuid, { limit: 50 })
    .map((g) => ({
      matchId: g.matchId,
      terminoAt: g.endedAt,
      gano: g.win,
      campeon: g.champion,
    }))
    .reverse();
  return { cuenta: label, partidas };
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
