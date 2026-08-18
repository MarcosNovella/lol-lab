import { beforeEach, describe, expect, it } from 'vitest';
import { tagGame, tagOf } from '../src/analysis/capture.ts';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { finishSyncLog, saveMatch, startSyncLog, upsertAccount } from '../src/store/matches.ts';
import {
  abrirSesion,
  cerrarSesion,
  estado,
  pendientes,
  RouteError,
  type SyncEvento,
  sincronizar,
  syncEnCurso,
  taguear,
} from '../src/ui/routes.ts';
import { guard, HOST, newToken } from '../src/ui/server.ts';
import { match, participant } from './fixtures.ts';

/**
 * The UI's guards and its status panel.
 *
 * The HTTP layer is deliberately thin enough that there is nothing in it to test; everything
 * worth pinning is either a pure decision (`guard`) or a function over the database (`estado`).
 *
 * There is deliberately no test asserting "estado spends no Riot request". The whole file runs
 * with no key and no network and every case passes, which proves it; a test restating it would
 * assert nothing and add a line the next reader has to evaluate.
 */

const CREATION = 1_760_000_000_000;
const HOUR = 3_600_000;
const ORIGIN = `http://${HOST}:4477`;

function seedGame(db: Db, matchId: string, at: number, puuid = 'smurf-puuid'): void {
  const raw = match({
    matchId,
    gameCreation: at,
    durationSeconds: 1800,
    participants: [
      participant({ puuid, teamId: 100, teamPosition: 'MIDDLE' }),
      participant({ puuid: `${matchId}-enemy`, teamId: 200, teamPosition: 'MIDDLE', win: false }),
    ],
  });
  saveMatch(db, flattenMatch(raw), raw);
}

describe('guard', () => {
  const expected = { token: 'good', origin: ORIGIN };

  it('refuses a request with the wrong token, or none', () => {
    expect(guard({ method: 'GET', token: null, origin: null }, expected).ok).toBe(false);
    expect(guard({ method: 'GET', token: 'bad', origin: null }, expected).ok).toBe(false);
    expect(guard({ method: 'GET', token: 'good', origin: null }, expected).ok).toBe(true);
  });

  it('refuses a mutating request from another site even with a valid token', () => {
    // The case this exists for: the token leaked — a screenshot, a shell history, a URL pasted
    // into a chat — and some other page tries to spend it. A same-origin fetch sends our own
    // Origin or none at all; anything else is a different site talking to us.
    const foreign = { method: 'POST', token: 'good', origin: 'https://otro.example' };
    expect(guard(foreign, expected).ok).toBe(false);
    expect(guard({ ...foreign, origin: ORIGIN }, expected).ok).toBe(true);
    expect(guard({ ...foreign, origin: null }, expected).ok).toBe(true);
  });

  it('does not apply the origin rule to reads', () => {
    // A GET cannot write a tag or spend a request, and browsers attach an Origin to plenty of
    // ordinary reads. Refusing those would break the page for no gain.
    expect(
      guard({ method: 'GET', token: 'good', origin: 'https://otro.example' }, expected).ok,
    ).toBe(true);
  });

  it('mints a different token every boot', () => {
    expect(newToken()).not.toBe(newToken());
    expect(newToken().length).toBeGreaterThan(20);
  });
});

describe('estado', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'smurf-puuid',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
  });

  it('counts the games that still need a tag, and stops counting them once tagged', () => {
    seedGame(db, 'LA2_A', CREATION);
    seedGame(db, 'LA2_B', CREATION + HOUR);
    expect(estado(db).pendientesTotal).toBe(2);

    tagGame(db, { matchId: 'LA2_A', puuid: 'smurf-puuid', tag: 'mía' });
    expect(estado(db).pendientesTotal).toBe(1);
  });

  it('puts tagging first, because it is the only input that cannot be recovered later', () => {
    seedGame(db, 'LA2_A', CREATION);
    const ids = estado(db).acciones.map((a) => a.id);
    expect(ids[0]).toBe('taguear');
  });

  it('says nothing at all when there is nothing to do', () => {
    seedGame(db, 'LA2_A', CREATION);
    tagGame(db, { matchId: 'LA2_A', puuid: 'smurf-puuid', tag: 'igual' });
    const id = startSyncLog(db, 'smurf-puuid', 420);
    finishSyncLog(db, id, { idsSeen: 1, fetched: 1, skipped: 0, timelines: 1 }, null);

    // The key action still fires here because no .env exists in a test run; what must NOT fire
    // is tagging or syncing. A panel that always has something to say stops being read.
    const ids = estado(db).acciones.map((a) => a.id);
    expect(ids).not.toContain('taguear');
    expect(ids).not.toContain('sync');
  });

  it('tells "never synced" apart from "synced a long time ago"', () => {
    seedGame(db, 'LA2_A', CREATION);

    // Never synced: there is no timestamp, and the absent one must not be read as epoch 0.
    // Mapping it to 0 makes the age five hundred thousand hours — a plausible-looking number
    // standing in for a missing one, which is exactly the substitution G-005 exists to stop.
    const nunca = estado(db, CREATION).acciones.find((a) => a.id === 'sync');
    expect(nunca?.porque).toContain('nunca');

    const id = startSyncLog(db, 'smurf-puuid', 420);
    finishSyncLog(db, id, { idsSeen: 0, fetched: 0, skipped: 0, timelines: 0 }, null);
    const reciente = estado(db).acciones.find((a) => a.id === 'sync');
    expect(reciente).toBeUndefined();
  });

  it('reports a sync that never finished as such, not as a successful one', () => {
    seedGame(db, 'LA2_A', CREATION);
    startSyncLog(db, 'smurf-puuid', 420); // deliberately not finished
    expect(estado(db).cuentas[0]?.ultimoSync?.terminado).toBe(false);
  });

  it('never carries any part of the key value, by shape', () => {
    // Asserted structurally rather than by scanning for a string: this fails the moment somebody
    // adds `masked`, `valor` or anything like it to the payload, which is the change that would
    // actually cause a leak. `keyState` does return a first-and-last-four `masked`, and it stops
    // here on purpose — the panel is fully useful without it (G-002).
    expect(Object.keys(estado(db).key).sort()).toEqual([
      'archivo',
      'horasDesdeQueSePego',
      'presente',
      'probablementeVencida',
      'problema',
      'tipo',
    ]);
  });
});

describe('la captura por click', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'smurf-puuid',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
  });

  it('lists the pending games OLDEST first', () => {
    seedGame(db, 'LA2_VIEJA', CREATION);
    seedGame(db, 'LA2_NUEVA', CREATION + HOUR);
    // He replays the session in the order he lived it. `untaggedGames` hands back newest first
    // because every other consumer wants that, so the flip belongs here and is worth pinning.
    expect(pendientes(db, 'smurf').partidas.map((p) => p.matchId)).toEqual([
      'LA2_VIEJA',
      'LA2_NUEVA',
    ]);
  });

  it('writes the tag BEFORE returning, which is the whole guarantee', () => {
    seedGame(db, 'LA2_A', CREATION);
    const ended = CREATION + 1800 * 1000;
    taguear(db, { cuenta: 'smurf', matchId: 'LA2_A', tag: 'mía' }, ended + 10 * 60_000);

    // Verified for real by SIGKILLing the server mid-ritual: the tags already clicked were on
    // disk and the session row stayed honestly open. This is that property, in a unit.
    expect(tagOf(db, 'LA2_A', 'smurf-puuid')).toBe('mía');
    expect(pendientes(db, 'smurf').partidas).toHaveLength(0);
  });

  it('reports the recall lag, measured from the END of the game', () => {
    seedGame(db, 'LA2_A', CREATION);
    const ended = CREATION + 1800 * 1000;
    const result = taguear(db, { cuenta: 'smurf', matchId: 'LA2_A', tag: 'pareja' }, ended + HOUR);
    // One hour, not one hour and a half: a 30-minute game tagged an hour after it finished did
    // not decay for the time it was being played (ADR-015).
    expect(result.atrasoMs).toBe(HOUR);
  });

  it('refuses a tag it does not know instead of storing it', () => {
    seedGame(db, 'LA2_A', CREATION);
    expect(() =>
      taguear(db, { cuenta: 'smurf', matchId: 'LA2_A', tag: 'culpa del jungla' }),
    ).toThrow(RouteError);
    expect(tagOf(db, 'LA2_A', 'smurf-puuid')).toBeNull();
  });

  it('refuses a game this account did not play', () => {
    expect(() => taguear(db, { cuenta: 'smurf', matchId: 'LA2_AJENA', tag: 'mía' })).toThrow();
  });

  it('refuses an account that is not in the cache', () => {
    expect(() => pendientes(db, 'main')).toThrow(RouteError);
  });

  it('stores a declined tilt as NULL, never as a middling 3', () => {
    const { sesion } = abrirSesion(db, 'smurf');
    cerrarSesion(db, { sesion, tilt: null });
    const row = db.prepare('SELECT tilt, closed_at FROM play_sessions WHERE id = ?').get(sesion) as
      | { tilt: number | null; closed_at: number | null }
      | undefined;
    expect(row?.tilt).toBeNull();
    // Closed, though: "he answered nothing" and "the sitting never ended" are different facts.
    expect(row?.closed_at).not.toBeNull();
  });

  it('carries the session onto the tags typed during it', () => {
    seedGame(db, 'LA2_A', CREATION);
    const { sesion } = abrirSesion(db, 'smurf');
    taguear(db, { cuenta: 'smurf', matchId: 'LA2_A', tag: 'igual', sesion });
    const row = db.prepare('SELECT session_id FROM game_tags WHERE match_id = ?').get('LA2_A') as
      | { session_id: number }
      | undefined;
    expect(row?.session_id).toBe(sesion);
  });
});

describe('el sync', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'smurf-puuid',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
  });

  const okSync = async (
    _puuid: string,
    onProgress: (done: number, total: number) => void,
  ): Promise<{ fetched: number; timelines: number; remakes: number; errors: string[] }> => {
    onProgress(1, 2);
    onProgress(2, 2);
    return { fetched: 2, timelines: 2, remakes: 0, errors: [] };
  };

  it('streams start, progress and finish, in that order', async () => {
    const eventos: SyncEvento[] = [];
    await sincronizar(db, 'smurf', (e) => eventos.push(e), { sync: okSync });
    expect(eventos.map((e) => e.tipo)).toEqual(['inicio', 'progreso', 'progreso', 'fin']);
  });

  it('refuses a second sync while one is running', async () => {
    let soltar: () => void = () => {};
    const lento = new Promise<void>((resolve) => {
      soltar = resolve;
    });

    const primero = sincronizar(db, 'smurf', () => {}, {
      sync: async () => {
        await lento;
        return { fetched: 0, timelines: 0, remakes: 0, errors: [] };
      },
    });

    expect(syncEnCurso()).toBe(true);
    // Two syncs would each hold their own limiter, and between them could blow the
    // 100-per-2-minutes budget — which Riot answers with 429s that read like a dead key.
    await expect(sincronizar(db, 'smurf', () => {}, { sync: okSync })).rejects.toThrow(RouteError);

    soltar();
    await primero;
    expect(syncEnCurso()).toBe(false);
  });

  it('releases the lock when the sync fails, instead of wedging the button forever', async () => {
    const eventos: SyncEvento[] = [];
    await sincronizar(db, 'smurf', (e) => eventos.push(e), {
      sync: async () => {
        throw new Error('key vencida');
      },
    });
    // The failure is REPORTED, not thrown: the stream has to carry it to the page.
    expect(eventos.at(-1)).toEqual({ tipo: 'error', mensaje: 'key vencida' });
    expect(syncEnCurso()).toBe(false);
  });

  it('does not let the rank clock turn a good sync into a failed one', async () => {
    const eventos: SyncEvento[] = [];
    await sincronizar(db, 'smurf', (e) => eventos.push(e), {
      sync: okSync,
      rango: async () => {
        throw new Error('league-v4 caída');
      },
    });
    // The clock is a nice-to-have and the sync is not; today it simply does not advance.
    expect(eventos.at(-1)?.tipo).toBe('fin');
  });

  it('refuses an unknown account before touching the lock', async () => {
    await expect(sincronizar(db, 'main', () => {}, { sync: okSync })).rejects.toThrow(RouteError);
    expect(syncEnCurso()).toBe(false);
  });
});
