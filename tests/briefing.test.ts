import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FocusCandidate,
  HORIZON_GAMES,
  pickFocus,
  type RunwayFacts,
  runway,
} from '../src/analysis/briefing.ts';
import { flattenMatch } from '../src/analysis/flatten.ts';
import {
  type AnalysisSpec,
  evaluateHypothesis,
  registerHypothesis,
} from '../src/analysis/hypotheses.ts';
import { assembleBriefing, PregameError } from '../src/pregame.ts';
import { exposureOf, gamesSince, recordExposure, SESSION_GAP_MS } from '../src/store/briefings.ts';
import { type Db, openDb } from '../src/store/db.ts';
import { saveMatch, upsertAccount } from '../src/store/matches.ts';
import { match, participant } from './fixtures.ts';

/**
 * El momento previo a jugar, y la regla que decide qué se le puede decir.
 *
 * Lo que más importa acá no es que el briefing se arme: es que se NIEGUE a mostrar una fila que
 * todavía puede dar un veredicto limpio, y que lo que sí muestra quede anotado. Esas dos cosas
 * son la razón de existir del módulo (ADR-022) y las dos están pinneadas abajo.
 */

const CREATION = 1_760_000_000_000;
const HOUR = 3_600_000;

const candidate = (over: Partial<FocusCandidate> & { id: string }): FocusCandidate => ({
  claim: `claim de ${over.id}`,
  caveat: 'cautela',
  nNeeded: 100,
  n: 0,
  exposedSince: null,
  ...over,
});

describe('la pista libre', () => {
  const base: RunwayFacts = {
    cuentas: [{ pendientes: 0, ultimoSyncAt: CREATION }],
    key: { presente: true, probablementeVencida: false, problema: null },
    now: CREATION,
  };

  it('no dice nada cuando no hay nada que arreglar', () => {
    expect(runway(base)).toEqual([]);
  });

  it('pone taguear primero, porque es lo único que no se recupera mañana', () => {
    const acciones = runway({ ...base, cuentas: [{ pendientes: 2, ultimoSyncAt: CREATION }] });
    expect(acciones[0]?.id).toBe('taguear');
    expect(acciones[0]?.que).toContain('2 partidas');
  });

  it('distingue "nunca sincronizada" de "hace mucho", en vez de leer la ausencia como época 0', () => {
    const nunca = runway({ ...base, cuentas: [{ pendientes: 0, ultimoSyncAt: null }] });
    expect(nunca.find((a) => a.id === 'sync')?.porque).toContain('nunca');

    const vieja = runway({
      ...base,
      cuentas: [{ pendientes: 0, ultimoSyncAt: CREATION - 20 * HOUR }],
    });
    expect(vieja.find((a) => a.id === 'sync')?.porque).toContain('20 h');
  });

  it('pide la key sin key, y la marca urgente solo cuando no hay ninguna', () => {
    const sin = runway({
      ...base,
      key: { presente: false, probablementeVencida: false, problema: null },
    });
    expect(sin.find((a) => a.id === 'key')?.urgencia).toBe('ahora');

    const vencida = runway({
      ...base,
      key: { presente: true, probablementeVencida: true, problema: 'hace 30 h' },
    });
    expect(vencida.find((a) => a.id === 'key')?.urgencia).toBe('cuando_puedas');
  });
});

describe('qué se le puede mostrar antes de jugar', () => {
  it('no muestra nada cuando el ledger está vacío, y dice por qué', () => {
    const { focus, noFocusReason } = pickFocus([]);
    expect(focus).toBeNull();
    expect(noFocusReason).toContain('no hay predicción registrada');
  });

  it('GUARDA la fila que todavía puede dar un veredicto limpio, y la cuenta', () => {
    // El caso entero del módulo: a esta le faltan 20 mediciones, está al alcance, y decírsela
    // antes de jugar quema la única medición limpia que va a tener.
    const { focus, withheld, noFocusReason } = pickFocus([
      candidate({ id: 'diana_needs_a_lead', nNeeded: 25, n: 5 }),
    ]);
    expect(focus).toBeNull();
    expect(withheld).toEqual([{ id: 'diana_needs_a_lead', shortfall: 20, reason: 'al_alcance' }]);
    expect(noFocusReason).toContain('faltan 20');
    expect(noFocusReason).toContain('El silencio de acá es la decisión');
  });

  it('GASTA la que no se va a resolver nunca, porque callarla no compra un veredicto', () => {
    const { focus, withheld } = pickFocus([
      candidate({ id: 'lejana', nNeeded: 1200, n: 269 }),
      candidate({ id: 'cercana', nNeeded: 25, n: 5 }),
    ]);
    expect(focus?.id).toBe('lejana');
    expect(focus?.shortfall).toBe(931);
    expect(focus?.why).toContain('muchas más de las que vas a juntar');
    expect(withheld.map((w) => w.id)).toEqual(['cercana']);
  });

  it('prefiere una ya expuesta antes que gastar una nueva', () => {
    // La exposición es irreversible: volver a mostrar la que ya vio no ensucia nada nuevo,
    // mostrar otra sí.
    const { focus } = pickFocus([
      candidate({ id: 'nueva', nNeeded: 1000, n: 900 }),
      candidate({ id: 'vista', nNeeded: 1000, n: 1, exposedSince: CREATION }),
    ]);
    expect(focus?.id).toBe('vista');
    expect(focus?.alreadyExposed).toBe(true);
    expect(focus?.why).toContain('no ensucia nada nuevo');
  });

  it('entre gastables elige la más medida, y desempata por id para ser determinística', () => {
    const masMedida = pickFocus([
      candidate({ id: 'a', nNeeded: 1000, n: 10 }),
      candidate({ id: 'b', nNeeded: 1000, n: 40 }),
    ]);
    expect(masMedida.focus?.id).toBe('b');

    const empate = pickFocus([
      candidate({ id: 'zeta', nNeeded: 1000, n: 10 }),
      candidate({ id: 'alfa', nNeeded: 1000, n: 10 }),
    ]);
    expect(empate.focus?.id).toBe('alfa');
  });

  it('nunca elige una fila que YA puede resolverse', () => {
    // Faltante 0 es la fila a la que menos hay que tocarle nada: el veredicto está a mano.
    const { focus, withheld } = pickFocus([candidate({ id: 'lista', nNeeded: 10, n: 30 })]);
    expect(focus).toBeNull();
    expect(withheld).toEqual([{ id: 'lista', shortfall: 0, reason: 'al_alcance' }]);
  });

  it('NO gasta una fila que nunca se evaluó: un desconocido no es un cero', () => {
    // Sin este caso el defecto es invisible y caro: leído como n=0, el faltante es el total,
    // la fila parece lejísimos del veredicto y se gasta — al revés de lo que corresponde. Se
    // vio corriendo `lol antes` contra una caché sembrada, con el ledger sin evaluar (G-029).
    const { focus, withheld, noFocusReason } = pickFocus([
      candidate({ id: 'nunca_evaluada', nNeeded: 1200, n: null }),
    ]);
    expect(focus).toBeNull();
    expect(withheld).toEqual([{ id: 'nunca_evaluada', shortfall: null, reason: 'sin_evaluar' }]);
    expect(noFocusReason).toContain('lol hip evaluar');
  });

  it('sí gasta una sin evaluar que YA se había mostrado, porque el gasto es irreversible', () => {
    const { focus } = pickFocus([
      candidate({ id: 'vista', nNeeded: 1200, n: null, exposedSince: CREATION }),
    ]);
    expect(focus?.id).toBe('vista');
    expect(focus?.shortfall).toBe(1200);
  });

  it('la perilla del horizonte da la misma partición entre 100 y 269, y cambia en 270', () => {
    // El barrido que justifica HORIZON_GAMES, sobre los faltantes reales de 2026-08-19, y el
    // borde exacto donde deja de dar igual. La primera versión de este test afirmaba que el
    // rango llegaba a 400 y era falso: en 270 `lead_conversion_gap` pasa a guardarse. El número
    // vive adentro de un rango insensible de 100 a 269, no de uno inventado.
    const ledger = [
      candidate({ id: 'diana_needs_a_lead', nNeeded: 25, n: 5 }), // faltan 20
      candidate({ id: 'team_state_dominates_500g', nNeeded: 88, n: 19 }), // faltan 69
      candidate({ id: 'lead_conversion_gap', nNeeded: 300, n: 30 }), // faltan 270
      candidate({ id: 'lead_conversion_gap_gold', nNeeded: 800, n: 26 }), // faltan 774
      candidate({ id: 'ward_before_objective_60s', nNeeded: 1200, n: 269 }), // faltan 931
    ];
    const guardadas = (h: number) => pickFocus(ledger, h).withheld.map((w) => w.id);
    const esperado = ['diana_needs_a_lead', 'team_state_dominates_500g'];
    expect(guardadas(100)).toEqual(esperado);
    expect(guardadas(HORIZON_GAMES)).toEqual(esperado);
    expect(guardadas(269)).toEqual(esperado);

    // El borde, medido en vez de supuesto: 270 es lo que le falta a lead_conversion_gap, que a
    // razón de ~4 partidas-con-ventaja por sentada son más de ocho meses. Un horizonte que la
    // guarda está afirmando que ese veredicto está al alcance, y no lo está.
    expect(guardadas(270)).toContain('lead_conversion_gap');

    // Y en el extremo caro: un horizonte de 1000 guarda hasta la que no se resuelve nunca.
    expect(guardadas(1000)).toContain('ward_before_objective_60s');
  });
});

describe('la anotación de lo que se le mostró', () => {
  let db: Db;
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
  const SPEC_LEJANA: AnalysisSpec = { ...SPEC };
  const SPEC_CERCANA: AnalysisSpec = { ...SPEC, champion: 'Diana' };

  function seedGame(db: Db, matchId: string, at: number, durationSeconds = 1800): void {
    const raw = match({
      matchId,
      gameCreation: at,
      durationSeconds,
      participants: [
        participant({ puuid: 'smurf-puuid', teamId: 100, teamPosition: 'MIDDLE' }),
        participant({ puuid: `${matchId}-e`, teamId: 200, teamPosition: 'MIDDLE', win: false }),
      ],
    });
    saveMatch(db, flattenMatch(raw), raw);
  }

  beforeEach(() => {
    db = openDb(':memory:');
    upsertAccount(db, {
      puuid: 'smurf-puuid',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
    registerHypothesis(
      db,
      {
        id: 'lejana',
        claim: 'una fila que no se resuelve en meses',
        direction: 'higher',
        spec: SPEC_LEJANA,
        baselineUntil: CREATION - HOUR,
        testFrom: CREATION,
        gapGames: 0,
        baselineN: 269,
        baselineEffect: 0.072,
        nNeeded: 1200,
        caveat: 'necesita mil doscientas mediciones',
      },
      CREATION - HOUR,
    );
  });

  it('no hay exposición hasta que se muestra', () => {
    expect(exposureOf(db, 'lejana')).toBeNull();
  });

  it('cuenta sentadas, no refrescadas de la página', () => {
    expect(recordExposure(db, { hypothesisId: 'lejana', puuid: 'smurf-puuid' }, CREATION)).toBe(
      true,
    );
    // El panel se abre varias veces por noche: eso es una sola sentada.
    expect(
      recordExposure(db, { hypothesisId: 'lejana', puuid: 'smurf-puuid' }, CREATION + HOUR),
    ).toBe(false);
    expect(
      recordExposure(
        db,
        { hypothesisId: 'lejana', puuid: 'smurf-puuid' },
        CREATION + SESSION_GAP_MS + 1,
      ),
    ).toBe(true);

    const exposicion = exposureOf(db, 'lejana');
    expect(exposicion?.count).toBe(2);
    expect(exposicion?.first).toBe(CREATION);
  });

  it('cuenta las partidas jugadas desde la exposición, y descarta los remakes', () => {
    recordExposure(db, { hypothesisId: 'lejana', puuid: 'smurf-puuid' }, CREATION);
    seedGame(db, 'LA2_ANTES', CREATION - 2 * HOUR);
    seedGame(db, 'LA2_DESPUES', CREATION + HOUR);
    seedGame(db, 'LA2_REMAKE', CREATION + 2 * HOUR, 68);

    // Una partida de 68 segundos no tiene comportamiento que contaminar.
    expect(gamesSince(db, 'smurf-puuid', CREATION)).toBe(1);
  });

  it('no muestra una fila del ledger que todavía no se evaluó', () => {
    // El ledger sembrado en este bloque nunca corrió una evaluación, así que no se sabe cuánto
    // acumuló ninguna fila y no se gasta ninguna.
    const b = assembleBriefing(db, 'smurf', CREATION);
    expect(b.focus).toBeNull();
    expect(b.withheld).toEqual([{ id: 'lejana', shortfall: null, reason: 'sin_evaluar' }]);
    expect(exposureOf(db, 'lejana')).toBeNull();
  });

  it('arma el briefing, anota el foco y no lo vuelve a anotar en la misma sentada', () => {
    evaluateHypothesis(db, 'lejana', SPEC_LEJANA, () => ({ n: 12, effect: 0.1 }), {
      now: CREATION - 1,
    });
    const primero = assembleBriefing(db, 'smurf', CREATION);
    expect(primero.focus?.id).toBe('lejana');
    expect(primero.focus?.alreadyExposed).toBe(false);
    expect(exposureOf(db, 'lejana')?.count).toBe(1);

    const segundo = assembleBriefing(db, 'smurf', CREATION + HOUR);
    // Ya la vio: la segunda lectura lo dice, y no infla el conteo.
    expect(segundo.focus?.alreadyExposed).toBe(true);
    expect(exposureOf(db, 'lejana')?.count).toBe(1);
  });

  it('no anota nada cuando decidió no mostrar nada', () => {
    const db2 = openDb(':memory:');
    upsertAccount(db2, {
      puuid: 'smurf-puuid',
      gameName: 'LegendofTorcuato',
      tagLine: 'LAS',
      platform: 'la2',
      label: 'smurf',
    });
    registerHypothesis(
      db2,
      {
        id: 'cercana',
        claim: 'una fila al alcance de un veredicto',
        direction: 'lower',
        spec: SPEC_CERCANA,
        baselineUntil: CREATION - HOUR,
        testFrom: CREATION,
        gapGames: 0,
        baselineN: 5,
        baselineEffect: -0.5,
        nNeeded: 25,
        caveat: 'n chico',
      },
      CREATION - HOUR,
    );

    evaluateHypothesis(db2, 'cercana', SPEC_CERCANA, () => ({ n: 5, effect: -0.4 }), {
      now: CREATION - 1,
    });
    const b = assembleBriefing(db2, 'smurf', CREATION);
    expect(b.focus).toBeNull();
    expect(b.withheld).toEqual([{ id: 'cercana', shortfall: 20, reason: 'al_alcance' }]);
    expect(exposureOf(db2, 'cercana')).toBeNull();
    db2.close();
  });

  it('falla con el nombre de las cuentas reales cuando la cuenta no existe', () => {
    expect(() => assembleBriefing(db, 'main', CREATION)).toThrow(PregameError);
    expect(() => assembleBriefing(db, 'main', CREATION)).toThrow(/smurf/);
  });
});
