import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIN_GAMES } from '../src/analysis/benchmark.ts';
import { tagGame, tagOf } from '../src/analysis/capture.ts';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { escapeForCmd } from '../src/cli/ui.ts';
import { safeAssetName } from '../src/riot/assets.ts';
import { KeyError, writeKey } from '../src/riot/key.ts';
import { type Db, openDb } from '../src/store/db.ts';
import {
  finishSyncLog,
  saveMatch,
  saveTimeline,
  startSyncLog,
  upsertAccount,
} from '../src/store/matches.ts';
import { CLIENT_SCRIPT } from '../src/ui/page.ts';
import {
  abrirSesion,
  cerrarSesion,
  cobertura,
  dejarAtras,
  estado,
  graficos,
  lectura,
  ledger,
  momentos,
  olvidarMapa,
  pendientes,
  prep,
  RouteError,
  type SyncEvento,
  sincronizar,
  syncEnCurso,
  taguear,
} from '../src/ui/routes.ts';
import { guard, HOST, newToken, startUiOnFreePort } from '../src/ui/server.ts';
import { lobby, match, participant } from './fixtures.ts';

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
    const ahora = CREATION + 2 * HOUR;
    expect(pendientes(db, 'smurf', ahora).deLaSesion.map((p) => p.matchId)).toEqual([
      'LA2_VIEJA',
      'LA2_NUEVA',
    ]);
  });

  it('separates tonight from the backlog', () => {
    seedGame(db, 'LA2_ANTIGUA', CREATION);
    seedGame(db, 'LA2_HOY', CREATION + 20 * HOUR);
    const ahora = CREATION + 21 * HOUR;

    const p = pendientes(db, 'smurf', ahora);
    expect(p.deLaSesion.map((g) => g.matchId)).toEqual(['LA2_HOY']);
    expect(p.atrasadas.map((g) => g.matchId)).toEqual(['LA2_ANTIGUA']);
    // Not dropped, just moved: a backlog he cannot see is a backlog he cannot decide about.
    // Tagging one is recall rather than observation, and the lag column records that either way.
    expect(p.atrasadas).toHaveLength(1);
  });

  it('writes the tag BEFORE returning, which is the whole guarantee', () => {
    seedGame(db, 'LA2_A', CREATION);
    const ended = CREATION + 1800 * 1000;
    taguear(db, { cuenta: 'smurf', matchId: 'LA2_A', tag: 'mía' }, ended + 10 * 60_000);

    // Verified for real by SIGKILLing the server mid-ritual: the tags already clicked were on
    // disk and the session row stayed honestly open. This is that property, in a unit.
    expect(tagOf(db, 'LA2_A', 'smurf-puuid')).toBe('mía');
    const restante = pendientes(db, 'smurf');
    expect([...restante.deLaSesion, ...restante.atrasadas]).toHaveLength(0);
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

describe('la página', () => {
  it('ships a client script that actually parses', () => {
    // The script lives inside a template literal, so a syntax error in it is invisible to tsc,
    // to Biome and to Vitest — the page would load, do nothing, and every check would be green.
    // This caught a real one: inside a template literal `\n` is a REAL newline, so a string
    // written as '\n' came out split across two lines and the whole script was unparseable.
    // Same blind spot G-018 was born from: the verify chain does not look inside strings.
    expect(() => new Function(CLIENT_SCRIPT)).not.toThrow();
  });

  it('never inlines data into the shell', () => {
    // The document is a shell on purpose: everything it shows comes from /api/*, so there is
    // exactly one place where each number is produced and no chance of the page and the API
    // disagreeing.
    expect(CLIENT_SCRIPT).toContain('/api/estado');
    expect(CLIENT_SCRIPT).toContain('/api/pendientes');
  });
});

describe('las vistas de lectura', () => {
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

  it('reports a game with no timeline as such instead of as one with no moments', () => {
    seedGame(db, 'LA2_A', CREATION);
    const [partida] = momentos(db, 'smurf');
    // Two different facts: "nothing was derivable" and "nothing expensive happened". Collapsing
    // them would quietly report a missing backfill as a clean game.
    expect(partida?.sinTimeline).toBe(true);
    expect(partida?.momentos).toEqual([]);
  });

  it('carries the tag onto the game it belongs to', () => {
    seedGame(db, 'LA2_A', CREATION);
    tagGame(db, { matchId: 'LA2_A', puuid: 'smurf-puuid', tag: 'mía' });
    expect(momentos(db, 'smurf')[0]?.tag).toBe('mía');
  });

  it('states the scope on every coverage answer', () => {
    seedGame(db, 'LA2_A', CREATION);
    // G-015: a coverage count without its window, queue and remake policy invites exactly the
    // false-discrepancy report that guardrail was born from.
    expect(cobertura(db, 'smurf').alcance).toEqual({
      cuenta: 'smurf',
      cola: 'todas',
      desde: null,
      remakes: 'excluidos',
    });
  });

  it('answers an empty ledger with an empty list, not an error', () => {
    expect(ledger(db)).toEqual([]);
  });

  it('draws a map even with no deaths, and says the count is zero', () => {
    seedGame(db, 'LA2_A', CREATION);
    const g = graficos(db, 'smurf');
    expect(g.muertes).toBe(0);
    expect(g.mapa).toContain('<svg');
  });

  it('reports prep for a matchup with no games as resting on nothing', () => {
    const p = prep(db, 'smurf', 'Diana', 'Sylas');
    expect(p.propias).toEqual({ ganadas: 0, jugadas: 0 });
    // No record and no prior: the honest answer is that there is nothing to say, and it must not
    // come out as `mayormente_propio` the way it did before G-019.
    expect(p.confianza).toBe('sin_datos');
  });
});

describe('la memoización del mapa de muertes', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    olvidarMapa();
    upsertAccount(db, {
      puuid: 'smurf-puuid',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
  });

  it('serves the same answer twice without recomputing', () => {
    seedGame(db, 'LA2_A', CREATION);
    const primera = graficos(db, 'smurf');
    const segunda = graficos(db, 'smurf');
    // Identity, not equality: the second call returned the memo rather than an equal object.
    expect(segunda).toBe(primera);
  });

  it('invalidates when a game arrives — the half that actually matters', () => {
    seedGame(db, 'LA2_A', CREATION);
    const antes = graficos(db, 'smurf');
    expect(antes.partidas).toBe(0); // no timeline yet, so nothing derivable

    seedGame(db, 'LA2_B', CREATION + HOUR);
    const despues = graficos(db, 'smurf');
    // A cache that does not invalidate is worse than no cache: it would keep answering with a
    // map that silently predates the games he just played.
    expect(despues).not.toBe(antes);
  });

  it('invalidates on a TIMELINE BACKFILL, which changes no game and no id', () => {
    seedGame(db, 'LA2_A', CREATION);
    const antes = graficos(db, 'smurf');
    expect(antes.partidas).toBe(0);

    // The trap this test exists for: backfilling adds deaths to a game already in the cache
    // without touching the game count or the newest id. A key built from those two alone would
    // serve a stale map forever after exactly the operation that produced the timelines.
    saveTimeline(db, 'LA2_A', {
      metadata: { matchId: 'LA2_A', participants: ['smurf-puuid', 'LA2_A-enemy'] },
      info: {
        frameInterval: 60_000,
        participants: [
          { participantId: 1, puuid: 'smurf-puuid' },
          { participantId: 2, puuid: 'LA2_A-enemy' },
        ],
        frames: [{ timestamp: 0, participantFrames: {}, events: [] }],
      },
    });

    const despues = graficos(db, 'smurf');
    expect(despues).not.toBe(antes);
    expect(despues.partidas).toBe(1);
  });
});

describe('el arranque', () => {
  it('moves to the next free port instead of dying on a busy one', async () => {
    const db = openDb(':memory:');
    // A busy 4477 is ordinary — a second window, a leftover process — and this is launched from
    // a desktop shortcut whose window closes, so an EADDRINUSE there would be an error he never
    // gets to read.
    const primero = await startUiOnFreePort({ port: 45810, db });
    const segundo = await startUiOnFreePort({ port: 45810, db });

    expect(primero.port).toBe(45810);
    expect(segundo.port).toBe(45811);
    // Each boot mints its own secret, so two windows cannot drive each other.
    expect(segundo.token).not.toBe(primero.token);

    await new Promise<void>((r) => primero.server.close(() => r()));
    await new Promise<void>((r) => segundo.server.close(() => r()));
    db.close();
  });

  it('gives up after the range instead of scanning forever', async () => {
    const db = openDb(':memory:');
    const ocupado = await startUiOnFreePort({ port: 45820, db });
    // tries: 0 means "this port or nothing", which is the shape that proves the loop is bounded.
    await expect(startUiOnFreePort({ port: 45820, db, tries: 0 })).rejects.toThrow();
    await new Promise<void>((r) => ocupado.server.close(() => r()));
    db.close();
  });
});

describe('abrir el navegador en Windows', () => {
  it('escapes what cmd would otherwise read as syntax', () => {
    // `start` is a cmd BUILTIN, so the shell parses the line before start sees it. These are the
    // characters that would end the command early.
    expect(escapeForCmd('http://127.0.0.1:4477/?t=abc&x=1')).toBe(
      'http://127.0.0.1:4477/?t=abc^&x=1',
    );
    expect(escapeForCmd('a|b')).toBe('a^|b');
    expect(escapeForCmd('a>b<c')).toBe('a^>b^<c');
  });

  it('leaves an ordinary token URL untouched', () => {
    // The tokens are base64url — letters, digits, `_` and `-` — so the normal case must come out
    // byte-identical. It did not: wrapping the URL in quotes made Node escape them into
    // \"http://...\", and `start` went looking for a file with that literal name. Adding
    // quotes to defend against a hypothetical `&` broke every real launch.
    const url = 'http://127.0.0.1:4477/?t=KxI6hqfMEpGFO0XzcI6lIGKJ8H2CwY9E';
    expect(escapeForCmd(url)).toBe(url);
    expect(escapeForCmd(url)).not.toContain('"');
  });
});

describe('dejar atrás el backlog', () => {
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

  it('takes the decision, reports its cost and stops demanding the impossible', () => {
    seedGame(db, 'LA2_A', CREATION);
    seedGame(db, 'LA2_B', CREATION + HOUR);
    expect(estado(db).acciones.map((a) => a.id)).toContain('taguear');

    const now = CREATION + 100 * HOUR;
    const result = dejarAtras(db, now);
    expect(result.dejadasAtras).toBe(2);

    const after = estado(db, now);
    expect(after.pendientesTotal).toBe(0);
    expect(after.acciones.map((a) => a.id)).not.toContain('taguear');
    // The games did not disappear: the panel says how many were left, and when it was decided.
    expect(after.cuentas[0]?.dejadasAtras).toBe(2);
    expect(after.corteDeTagueo).toEqual({ at: now, setAt: now, dejadasAtras: 2 });
  });

  it('leaves the games played after the decision fully askable', () => {
    seedGame(db, 'LA2_OLD', CREATION);
    const now = CREATION + 100 * HOUR;
    dejarAtras(db, now);

    seedGame(db, 'LA2_NEXT', now + HOUR);
    const after = estado(db, now + 3 * HOUR);
    expect(after.pendientesTotal).toBe(1);
    expect(after.acciones.map((a) => a.id)).toContain('taguear');
    expect(pendientes(db, 'smurf', now + 3 * HOUR).deLaSesion.map((p) => p.matchId)).toEqual([
      'LA2_NEXT',
    ]);
  });
});

describe('las imágenes locales', () => {
  it('rejects anything that is not a bare file name', () => {
    expect(safeAssetName('Ahri.png')).toBe(true);
    expect(safeAssetName('3100.png')).toBe(true);
    // The server hands this to the filesystem, so these are the ones that matter.
    expect(safeAssetName('../.env')).toBe(false);
    expect(safeAssetName('..')).toBe(false);
    expect(safeAssetName('a/b.png')).toBe(false);
    expect(safeAssetName('a\b.png')).toBe(false);
    expect(safeAssetName('')).toBe(false);
  });

  it('serves art without a token but refuses to leave its folder', async () => {
    const db = openDb(':memory:');
    const ui = await startUiOnFreePort({ port: 45840, db });

    // No token at all: the art is Riot's, carries nothing about him, and staying token-free is
    // what lets the memoised SVG survive a reboot.
    const traversal = await fetch(
      `${ui.url.split('/?')[0]}/img/champion/${encodeURIComponent('../../.env')}`,
    );
    expect(traversal.status).toBe(404);

    const rareFolder = await fetch(`${ui.url.split('/?')[0]}/img/otra/cosa.png`);
    expect(rareFolder.status).toBe(404);

    // A well-formed name that is simply not downloaded says what to run, rather than 500ing.
    const missing = await fetch(`${ui.url.split('/?')[0]}/img/champion/NoExiste.png`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain('lol assets');

    await new Promise<void>((r) => ui.server.close(() => r()));
    db.close();
  });
});

describe('pegar la key desde el panel', () => {
  // NUNCA contra el .env real: `writeKey` toma un destino por la misma razón que `openDb`, y sin
  // eso este bloque le borraría la key buena a cada `pnpm verify`.
  const tmp = join(tmpdir(), `lol-key-test-${process.pid}.env`);
  afterEach(() => {
    rmSync(tmp, { force: true });
  });

  it('escribe la key y deja el resto del archivo intacto', () => {
    writeFileSync(tmp, 'RIOT_PLATFORM=la2\nRIOT_API_KEY=RGAPI-vieja\n# un comentario\n');
    writeKey('RGAPI-nueva-1234', tmp);
    const after = readFileSync(tmp, 'utf8');
    expect(after).toContain('RIOT_API_KEY=RGAPI-nueva-1234');
    expect(after).toContain('RIOT_PLATFORM=la2');
    expect(after).toContain('# un comentario');
    expect(after).not.toContain('RGAPI-vieja');
  });

  it('agrega la línea cuando el archivo existe pero no la tiene', () => {
    writeFileSync(tmp, 'RIOT_PLATFORM=la2\n');
    writeKey('RGAPI-nueva', tmp);
    expect(readFileSync(tmp, 'utf8')).toContain('RIOT_API_KEY=RGAPI-nueva');
  });

  it('conserva los finales de línea CRLF en vez de convertir el archivo entero (G-010)', () => {
    writeFileSync(tmp, 'RIOT_PLATFORM=la2\r\nRIOT_API_KEY=RGAPI-vieja\r\n');
    writeKey('RGAPI-nueva', tmp);
    const after = readFileSync(tmp, 'utf8');
    expect(after).toContain('\r\n');
    expect(after.includes('\n\n')).toBe(false);
  });

  it('rechaza lo que no parece una key ANTES de tocar el archivo', () => {
    writeFileSync(tmp, 'RIOT_API_KEY=RGAPI-buena\n');
    expect(() => writeKey('pegué cualquier cosa', tmp)).toThrow(KeyError);
    expect(() => writeKey('', tmp)).toThrow(KeyError);
    expect(() => writeKey('RGAPI-con espacio', tmp)).toThrow(KeyError);
    // Lo que importa: media key pegada no puede dejar el archivo peor de lo que estaba.
    expect(readFileSync(tmp, 'utf8')).toContain('RGAPI-buena');
  });
});

describe('la lectura — qué estoy fallando y qué hago bien', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'me',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
    for (let i = 0; i < 8; i++) {
      const raw = lobby({
        matchId: `LA2_L${i}`,
        index: i,
        gameCreation: CREATION + i * HOUR,
        win: i % 2 === 0,
        myCsPerMinTarget: 7.6,
        peerCsPerMinTarget: 7,
      });
      raw.info.queueId = 420;
      saveMatch(db, flattenMatch(raw), raw);
    }
  });

  it('no deja que una métrica contaminada encabece la lectura (G-008)', () => {
    const l = lectura(db, 'smurf');
    // CS por minuto es la métrica más obvia y la más engañosa: su promedio está dominado por
    // las partidas que ganó. Puede mostrarse, pero no puede ser el titular.
    expect(l.barras.every((b) => !b.contaminada)).toBe(true);
    expect(l.mejor).not.toBe('CS por minuto');
    expect(l.peor).not.toBe('CS por minuto');
    // Y lo que quedó afuera se cuenta, para que el silencio sea visible.
    expect(l.contaminadas).toBeGreaterThan(0);
  });

  it('no titula nada cuando ninguna métrica es fuerte ni floja', () => {
    // El caso que apareció en pantalla: con todas las métricas empatadas la lista ordenada
    // igual tiene un primero, y titulaba "lo que mejor hacés" sobre una diferencia de cero.
    const plano = openDb(':memory:');
    upsertAccount(plano, {
      puuid: 'me',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
    for (let i = 0; i < 8; i++) {
      const raw = lobby({ matchId: `LA2_P${i}`, index: i, noVariance: true });
      raw.info.queueId = 420;
      saveMatch(plano, flattenMatch(raw), raw);
    }
    const l = lectura(plano, 'smurf');
    expect(l.mejor).toBeNull();
    expect(l.peor).toBeNull();
    plano.close();
  });

  it('manda el efecto no medible como null explícito, nunca como cero', () => {
    const l = lectura(db, 'smurf');
    for (const barra of l.barras) {
      expect(barra.effect === null || Number.isFinite(barra.effect)).toBe(true);
    }
    // El SVG se arma del lado donde el NaN todavía es NaN.
    expect(typeof l.barrasSvg).toBe('string');
    expect(l.barrasSvg.startsWith('<svg')).toBe(true);
  });

  it('cuenta los campeones que jugó, con sus victorias', () => {
    const l = lectura(db, 'smurf');
    const total = l.campeones.reduce((n, c) => n + c.partidas, 0);
    expect(total).toBe(l.partidas);
    expect(l.victorias + l.derrotas).toBe(l.partidas);
  });
});

describe('el reparto por tag en la lectura', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'me',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
    for (let i = 0; i < 8; i++) {
      const raw = lobby({ matchId: `LA2_T${i}`, index: i, win: i % 2 === 0 });
      raw.info.queueId = 420;
      saveMatch(db, flattenMatch(raw), raw);
    }
  });

  it('no existe hasta que haya un tag, en vez de mostrar tres ceros', () => {
    // Una sección con todo en cero se lee como "acá no pasa nada", que es lo contrario de
    // "todavía no hay nada que leer". Su backlog se cerró por decisión (ADR-019), así que este
    // es exactamente su estado hasta que tague la primera.
    expect(lectura(db, 'smurf').tags).toBeNull();
  });

  it('aparece con el primer tag y nunca dobla adentro las que faltan taguear', () => {
    tagGame(db, { matchId: 'LA2_T0', puuid: 'me', tag: 'mía' });
    const t = lectura(db, 'smurf').tags;
    expect(t?.tagueadas).toBe(1);
    // Las 7 restantes se reportan aparte: si se cayeran, cada tasa sería condicional a
    // "las partidas que se acordó de taguear", y acordarse no es independiente de cómo salió.
    expect(t?.sinTaguear).toBe(7);
  });

  it('NO enuncia un porcentaje con muestra chica, pero sí el crudo', () => {
    for (const id of ['LA2_T0', 'LA2_T1', 'LA2_T2']) {
      tagGame(db, { matchId: id, puuid: 'me', tag: 'mía' });
    }
    const mia = lectura(db, 'smurf').tags?.poblaciones.find((p) => p.tag === 'mía');
    expect(mia?.n).toBe(3);
    // 2 de 3 se lee igual de seguro que 200 de 300 y no lo es.
    expect(mia?.winrate).toBeNull();
    expect(mia?.victorias).toBeGreaterThanOrEqual(0);
  });

  it('enuncia la tasa recién al llegar al mínimo que el motor ya usa', () => {
    for (const id of ['LA2_T0', 'LA2_T1', 'LA2_T2', 'LA2_T3', 'LA2_T4']) {
      tagGame(db, { matchId: id, puuid: 'me', tag: 'igual' });
    }
    const t = lectura(db, 'smurf').tags;
    const igual = t?.poblaciones.find((p) => p.tag === 'igual');
    expect(igual?.n).toBe(t?.minimo);
    expect(igual?.winrate).not.toBeNull();
  });

  it('devuelve los tres grupos aunque dos estén vacíos', () => {
    tagGame(db, { matchId: 'LA2_T0', puuid: 'me', tag: 'pareja' });
    const t = lectura(db, 'smurf').tags;
    expect(t?.poblaciones.map((p) => p.tag)).toEqual(['mía', 'igual', 'pareja']);
    expect(t?.poblaciones.filter((p) => p.n === 0)).toHaveLength(2);
  });
});

describe('el mínimo de muestra vale para toda la lectura', () => {
  it('expone UN mínimo, el que el motor ya usa, y no uno inventado para la pantalla', () => {
    const db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'me',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
    for (let i = 0; i < 8; i++) {
      const raw = lobby({ matchId: `LA2_U${i}`, index: i, win: i % 2 === 0 });
      raw.info.queueId = 420;
      saveMatch(db, flattenMatch(raw), raw);
    }
    const l = lectura(db, 'smurf');
    // Un solo número para el porcentaje de un tag, el de un campeón y la barra de los dos: si
    // una tasa no se puede enunciar, tampoco se puede dibujar, y dos umbrales distintos en la
    // misma pantalla serían dos criterios de honestidad distintos.
    expect(l.minimo).toBe(MIN_GAMES);
    db.close();
  });
});

describe('la curva de crecimiento y su barrido', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'me',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
  });

  it('no dibuja nada con una sola partida en vez de una curva de un punto', () => {
    const raw = lobby({ matchId: 'LA2_G0', index: 0 });
    raw.info.queueId = 420;
    saveMatch(db, flattenMatch(raw), raw);
    expect(lectura(db, 'smurf').crecimiento).toBeNull();
  });

  it('barre la ventana de suavizado y marca inestable cuando el signo cambia', () => {
    // La lección más cara del proyecto, como test: una pendiente cuyo signo depende de cómo se
    // suavice no es una tendencia, y el "-0.147 por partida" que casi entró al ledger como
    // predicción fechada era exactamente eso (G-025).
    for (let i = 0; i < 24; i++) {
      const raw = lobby({ matchId: `LA2_G${i}`, index: i, win: i % 2 === 0 });
      raw.info.queueId = 420;
      // Sube y baja: ninguna ventana puede coincidir con la siguiente sobre esta forma.
      for (const p of raw.info.participants) {
        const mio = p.puuid === 'me';
        p.challenges = {
          ...p.challenges,
          laneMinionsFirst10Minutes: 70 + (mio ? Math.sin(i) * 12 : 0),
        };
      }
      saveMatch(db, flattenMatch(raw), raw);
    }
    const c = lectura(db, 'smurf').crecimiento;
    expect(c?.barrido.map((b) => b.ventana)).toEqual([5, 10, 20]);
    // Y la pendiente que se muestra es la AJUSTADA sobre todos los puntos, no dos puntas.
    expect(Number.isFinite(c?.pendiente ?? Number.NaN)).toBe(true);
    expect(typeof c?.inestable).toBe('boolean');
  });

  it('cuenta las descartadas en vez de dejarlas caer en silencio', () => {
    for (let i = 0; i < 6; i++) {
      const raw = lobby({ matchId: `LA2_H${i}`, index: i });
      raw.info.queueId = 420;
      saveMatch(db, flattenMatch(raw), raw);
    }
    const c = lectura(db, 'smurf').crecimiento;
    expect(c?.descartadas).toBeGreaterThanOrEqual(0);
    expect(c?.puntos).toBeGreaterThan(1);
  });
});

describe('el barrido de la curva tiene que barrer', () => {
  it('da pendientes DISTINTAS por ventana, porque es lo único que la ventana mueve', () => {
    // La primera versión ajustaba sobre los valores crudos, así que las tres ventanas devolvían
    // el mismo número: un barrido que no barre, con toda la cara de haber verificado algo. Se
    // vio mirando el payload, no lo vio ningún test — este es ese test.
    const db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'me',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
    for (let i = 0; i < 26; i++) {
      const raw = lobby({ matchId: `LA2_S${i}`, index: i, win: i % 2 === 0 });
      raw.info.queueId = 420;
      for (const p of raw.info.participants) {
        p.challenges = {
          ...p.challenges,
          // Una forma que sube y después baja: el suavizado tiene que cambiar la pendiente.
          laneMinionsFirst10Minutes: p.puuid === 'me' ? 60 + i * 2 - Math.max(0, i - 13) * 5 : 70,
        };
      }
      saveMatch(db, flattenMatch(raw), raw);
    }
    const barrido = lectura(db, 'smurf').crecimiento?.barrido ?? [];
    const pendientes = barrido.map((b) => b.pendiente.toFixed(4));
    expect(new Set(pendientes).size).toBeGreaterThan(1);
    db.close();
  });
});
