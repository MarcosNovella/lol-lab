import { beforeEach, describe, expect, it } from 'vitest';
import { tagGame } from '../src/analysis/capture.ts';
import { flattenMatch } from '../src/analysis/flatten.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { finishSyncLog, saveMatch, startSyncLog, upsertAccount } from '../src/store/matches.ts';
import { estado } from '../src/ui/routes.ts';
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
