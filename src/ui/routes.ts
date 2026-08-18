import { untaggedGames } from '../analysis/capture.ts';
import { describeRank, latestSnapshot, TRACKED_QUEUES } from '../analysis/rank.ts';
import { keyState } from '../riot/key.ts';
import type { Db } from '../store/db.ts';
import { lastSync, listAccounts } from '../store/matches.ts';

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
