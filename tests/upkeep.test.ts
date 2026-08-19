import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { flattenMatch } from '../src/analysis/flatten.ts';
import type { AnalysisSpec } from '../src/analysis/hypotheses.ts';
import { evaluationsOf, registerHypothesis } from '../src/analysis/hypotheses.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { hasCatalogForPatch, saveItems } from '../src/store/items.ts';
import { saveMatch, upsertAccount } from '../src/store/matches.ts';
import { bajarCatalogos, bajarImagenes, evaluarLedger, upkeepState } from '../src/upkeep.ts';
import { match, participant } from './fixtures.ts';

/**
 * Las tareas que antes había que acordarse de correr en la terminal.
 *
 * Nada de acá toca la red: lo que se prueba es la parte que decide QUÉ falta, que es la que hace
 * que los botones puedan correrse siempre sin bajar de nuevo lo que ya está.
 */

const CREATION = 1_760_000_000_000;

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

function seedGame(matchId: string, gameVersion: string): void {
  const raw = match({
    matchId,
    gameCreation: CREATION,
    durationSeconds: 1800,
    participants: [
      participant({ puuid: 'smurf-puuid', teamId: 100, teamPosition: 'MIDDLE' }),
      participant({ puuid: `${matchId}-e`, teamId: 200, teamPosition: 'MIDDLE', win: false }),
    ],
  });
  raw.info.gameVersion = gameVersion;
  saveMatch(db, flattenMatch(raw), raw);
}

describe('qué falta, sin bajar nada', () => {
  it('nombra los parches sin catálogo en vez de solo contarlos', () => {
    seedGame('LA2_A', '16.14.794.9266');
    seedGame('LA2_B', '16.16.100.1');
    saveItems(db, [
      {
        itemId: 3020,
        version: '16.14.1',
        name: 'Botas',
        goldTotal: 1000,
        finished: true,
        tags: 'Boots',
      },
    ]);

    const u = upkeepState(db);
    expect(u.catalogos.tengo).toBe(1);
    expect(u.catalogos.faltan).toBe(1);
    // Nombrado: un parche que Data Dragon no publique nunca no lo resuelve apretar el botón.
    expect(u.catalogos.sinPublicar).toEqual(['16.16']);
  });

  it('usa el mismo predicado que la lectura real, no un prefijo propio', () => {
    // El riesgo concreto: una versión de dos partes. Un `split('.').slice(0,2)` la daría por
    // cubierta y `catalogForPatch`, que pide `LIKE '16.14.%'`, no la encontraría nunca.
    saveItems(db, [
      {
        itemId: 3020,
        version: '16.14',
        name: 'Botas',
        goldTotal: 1000,
        finished: true,
        tags: 'Boots',
      },
    ]);
    seedGame('LA2_A', '16.14.794.9266');
    expect(hasCatalogForPatch(db, '16.14')).toBe(false);
    expect(upkeepState(db).catalogos.faltan).toBe(1);
  });

  it('cuenta las imágenes que faltan a partir de los campeones que realmente vio', () => {
    seedGame('LA2_A', '16.14.794.9266');
    // Contra una carpeta vacía y no contra la real: si el test leyera `data/img`, pasaría o
    // fallaría según si alguien bajó el arte alguna vez en esta máquina.
    const u = upkeepState(db, join(tmpdir(), `lol-sin-arte-${process.pid}`));
    // Sin carpeta de arte todavía: falta todo lo que aparezca en la caché.
    expect(u.imagenes.campeones).toBe(0);
    expect(u.imagenes.faltanCampeones).toBeGreaterThan(0);
    expect(u.imagenes.mapa).toBe(false);
  });

  it('no le pide nada a la red cuando no hay ninguna partida', async () => {
    // Sin parches no hay nada que preguntar, y preguntarlo igual sería un round trip por noche
    // para enterarse de que no cambió nada.
    await expect(bajarCatalogos(db)).resolves.toEqual({
      bajados: 0,
      yaEstaban: 0,
      sinPublicar: [],
    });
  });

  it('se niega a bajar imágenes sin catálogo, y dice por qué', async () => {
    // Los íconos de ítem salen del catálogo: sin él no se sabe qué ids bajar, y bajar "todos"
    // no existe.
    const r = await bajarImagenes(db);
    expect(r.bloqueado).toContain('catálogo');
    expect(r.bajadas).toBe(0);
  });
});

describe('evaluar el ledger', () => {
  const SPEC: AnalysisSpec = {
    puuid: 'smurf-puuid',
    role: 'MIDDLE',
    queueId: 420,
    minute: 14,
    band: 500,
    outcome: 'binary_win',
    stratum: 'none',
    champion: null,
  };

  it('appendea una evaluación por hipótesis viva y reporta los veredictos', () => {
    registerHypothesis(
      db,
      {
        id: 'una',
        claim: 'algo registrado',
        direction: 'higher',
        spec: SPEC,
        baselineUntil: CREATION - 1000,
        testFrom: CREATION,
        gapGames: 0,
        baselineN: 10,
        baselineEffect: 0.1,
        nNeeded: 300,
        caveat: 'n chico',
      },
      CREATION,
    );

    const r = evaluarLedger(db, CREATION + 1000);
    expect(r.evaluadas).toBe(1);
    // Sin partidas fuera de muestra el veredicto correcto es insufficient_n, no un error.
    expect(r.veredictos['insufficient_n']).toBe(1);
    expect(evaluationsOf(db, 'una')).toHaveLength(1);

    // Y es append-only: correrla de nuevo agrega una fila, no pisa la anterior.
    evaluarLedger(db, CREATION + 2000);
    expect(evaluationsOf(db, 'una')).toHaveLength(2);
  });

  it('con el ledger vacío no hace nada en vez de fallar', () => {
    expect(evaluarLedger(db)).toEqual({ evaluadas: 0, veredictos: {} });
  });
});
