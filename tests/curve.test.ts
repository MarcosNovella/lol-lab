import { describe, expect, it } from 'vitest';
import {
  biggestSwing,
  type PhaseSplit,
  phaseAverages,
  phaseSplit,
  stateCurve,
} from '../src/analysis/curve.ts';
import type { MatchDto, TimelineDto, TimelineEvent } from '../src/riot/types.ts';
import { match, participant } from './fixtures.ts';

function lobby(): MatchDto {
  return match({
    matchId: 'LA2_C',
    participants: [
      participant({ puuid: 'me', championName: 'Locke', teamId: 100, teamPosition: 'MIDDLE' }),
      participant({
        puuid: 'enemy',
        championName: 'Akali',
        teamId: 200,
        teamPosition: 'MIDDLE',
        win: false,
      }),
    ],
  });
}

type Row = { minute: number; myGold: number; theirGold: number; myCs?: number; theirCs?: number };

function timeline(rows: Row[], events: TimelineEvent[] = []): TimelineDto {
  return {
    metadata: { matchId: 'LA2_C', participants: ['me', 'enemy'] },
    info: {
      frameInterval: 60_000,
      participants: [
        { participantId: 1, puuid: 'me' },
        { participantId: 2, puuid: 'enemy' },
      ],
      frames: rows.map((r) => ({
        timestamp: r.minute * 60_000,
        participantFrames: {
          '1': {
            participantId: 1,
            totalGold: r.myGold,
            xp: r.myGold,
            minionsKilled: r.myCs ?? 0,
          },
          '2': {
            participantId: 2,
            totalGold: r.theirGold,
            xp: r.theirGold,
            minionsKilled: r.theirCs ?? 0,
          },
        },
        events: events.filter(
          (e) => e.timestamp >= r.minute * 60_000 && e.timestamp < (r.minute + 1) * 60_000,
        ),
      })),
    },
  };
}

/** Frames every minute from 0 to `last`, interpolating gold and cs linearly. */
function steady(last: number, myPerMin: number, theirPerMin: number): Row[] {
  return Array.from({ length: last + 1 }, (_, minute) => ({
    minute,
    myGold: minute * myPerMin,
    theirGold: minute * theirPerMin,
    myCs: minute * 8,
    theirCs: minute * 7,
  }));
}

describe('the state curve', () => {
  it('samples the requested minutes and names the minutes the game never reached', () => {
    const curve = stateCurve(lobby(), timeline(steady(21, 400, 350)), 'me');
    expect(curve.points.map((p) => p.minute)).toEqual([5, 10, 14, 20]);
    expect(curve.missing).toEqual([25, 30]);
    expect(curve.opponentChampion).toBe('Akali');
  });

  it('measures every point against the lane opponent, oriented so positive is his lead', () => {
    const curve = stateCurve(lobby(), timeline(steady(30, 400, 350)), 'me');
    const at14 = curve.points.find((p) => p.minute === 14);
    expect(at14?.goldDiff).toBe(14 * 400 - 14 * 350);
    expect(at14?.csDiff).toBe(14 * 8 - 14 * 7);
  });

  it('finds the window where the lead moved most, with its sign', () => {
    // Even until 14, then he loses 3000 between 14 and 20.
    const rows: Row[] = [];
    for (let minute = 0; minute <= 30; minute += 1) {
      const mine = minute <= 14 ? minute * 400 : 14 * 400 + (minute - 14) * 100;
      rows.push({ minute, myGold: mine, theirGold: minute * 400 });
    }
    const swing = biggestSwing(stateCurve(lobby(), timeline(rows), 'me'));
    expect(swing?.from).toBe(14);
    expect(swing?.to).toBe(20);
    expect(swing?.delta).toBe(-1800);
  });

  it('returns no swing for a curve with a single point', () => {
    expect(biggestSwing(stateCurve(lobby(), timeline(steady(6, 400, 400)), 'me'))).toBeNull();
  });
});

describe('the phase split', () => {
  it('divides by the minutes the phase actually had, not its nominal length', () => {
    // A 20-minute game: the mid phase ran 14->20, six minutes, not eleven.
    const phases = phaseSplit(lobby(), timeline(steady(20, 400, 350)), 'me');
    const mid = phases?.find((p) => p.name === 'medio');
    expect(mid?.minutes).toBe(6);
    expect(phases?.some((p) => p.name === 'cierre')).toBe(false);
  });

  it('survives the trailing partial frame instead of dropping a whole phase (G-017)', () => {
    // A 24:01 game ships 26 frames: 0..24 plus a partial one. Counting frames says 25 minutes,
    // minute 25 has no frame, and the entire 14-25 phase used to disappear without a word.
    const rows = steady(24, 400, 350);
    const tl = timeline(rows);
    const partial = tl.info.frames[tl.info.frames.length - 1];
    if (partial !== undefined) {
      tl.info.frames.push({ ...partial, timestamp: 24 * 60_000 + 1381 });
    }
    expect(tl.info.frames).toHaveLength(26);

    const phases = phaseSplit(lobby(), tl, 'me');
    expect(phases?.map((p) => p.name)).toEqual(['línea', 'medio']);
    expect(phases?.find((p) => p.name === 'medio')?.minutes).toBe(10);
  });

  it('puts the opponent CS/min beside his, because the rate alone is contaminated', () => {
    const phases = phaseSplit(lobby(), timeline(steady(30, 400, 350)), 'me');
    const lane = phases?.find((p) => p.name === 'línea');
    expect(lane?.csPerMin).toBeCloseTo(8);
    expect(lane?.opponentCsPerMin).toBeCloseTo(7);
  });

  it('counts deaths and kills into the phase they happened in', () => {
    const events: TimelineEvent[] = [
      { type: 'CHAMPION_KILL', timestamp: 5 * 60_000, victimId: 1, killerId: 2 },
      { type: 'CHAMPION_KILL', timestamp: 18 * 60_000, victimId: 1, killerId: 2 },
      { type: 'CHAMPION_KILL', timestamp: 27 * 60_000, victimId: 2, killerId: 1 },
    ];
    const phases = phaseSplit(lobby(), timeline(steady(30, 400, 350), events), 'me');
    expect(phases?.find((p) => p.name === 'línea')?.deaths).toBe(1);
    expect(phases?.find((p) => p.name === 'medio')?.deaths).toBe(1);
    expect(phases?.find((p) => p.name === 'cierre')?.kills).toBe(1);
  });
});

describe('promediar las fases sobre varias partidas', () => {
  const fase = (over: Partial<PhaseSplit> & { name: string }): PhaseSplit => ({
    from: 0,
    minutes: 14,
    csPerMin: 7,
    goldPerMin: 400,
    deaths: 1,
    kills: 1,
    opponentCsPerMin: 6.5,
    ...over,
  });

  it('le da a cada fase SU propio n: una partida corta no es un cierre de cero', () => {
    // Una de 22 minutos jugó línea y medio y nunca llegó al cierre. Contarla como un cierre
    // vacío hundiría el promedio de una fase que esa partida no jugó.
    const promedios = phaseAverages([
      [fase({ name: 'línea' }), fase({ name: 'medio', from: 14, minutes: 8 })],
      [
        fase({ name: 'línea' }),
        fase({ name: 'medio', from: 14, minutes: 11 }),
        fase({ name: 'cierre', from: 25, minutes: 6 }),
      ],
    ]);
    const porNombre = new Map(promedios.map((p) => [p.name, p]));
    expect(porNombre.get('línea')?.games).toBe(2);
    expect(porNombre.get('medio')?.games).toBe(2);
    expect(porNombre.get('cierre')?.games).toBe(1);
  });

  it('pondera por minuto jugado y no por partida', () => {
    // Un cierre de 2 minutos y uno de 20 no pueden pesar igual: si pesaran, un puñado de
    // segundos movería la fase entera.
    const promedios = phaseAverages([
      [fase({ name: 'cierre', from: 25, minutes: 2, csPerMin: 0, opponentCsPerMin: 0 })],
      [fase({ name: 'cierre', from: 25, minutes: 20, csPerMin: 10, opponentCsPerMin: 10 })],
    ]);
    const cierre = promedios.find((p) => p.name === 'cierre');
    // Promediado por partida daría 5. Ponderado por minuto son 200/22 = 9.09.
    expect(cierre?.csPerMin).toBeCloseTo(9.09, 1);
    expect(cierre?.minutes).toBe(22);
  });

  it('no trata un rival ausente como un rival que farmeó cero', () => {
    const promedios = phaseAverages([
      [fase({ name: 'línea', csPerMin: 7, opponentCsPerMin: 6 })],
      [fase({ name: 'línea', csPerMin: 7, opponentCsPerMin: Number.NaN })],
    ]);
    const linea = promedios.find((p) => p.name === 'línea');
    // Con el NaN leído como 0 el rival promediaría 3 y la diferencia sería +4.
    expect(linea?.opponentCsPerMin).toBeCloseTo(6, 5);
    expect(linea?.csDiff).toBeCloseTo(1, 5);
  });

  it('compara las dos puntas sobre las MISMAS partidas', () => {
    // La partida sin rival medible no puede entrar en su promedio pero sí en el de él: serían
    // dos muestras distintas restándose (G-015).
    const promedios = phaseAverages([
      [fase({ name: 'línea', csPerMin: 10, opponentCsPerMin: Number.NaN })],
      [fase({ name: 'línea', csPerMin: 6, opponentCsPerMin: 5 })],
    ]);
    const linea = promedios.find((p) => p.name === 'línea');
    expect(linea?.csDiff).toBeCloseTo(1, 5);
    // Y su promedio general, que sí incluye las dos, se reporta aparte.
    expect(linea?.csPerMin).toBeCloseTo(8, 5);
  });

  it('devuelve la fase con n=0 en vez de omitirla, para que el panel diga que falta', () => {
    const promedios = phaseAverages([[fase({ name: 'línea' })]]);
    expect(promedios).toHaveLength(3);
    const cierre = promedios.find((p) => p.name === 'cierre');
    expect(cierre?.games).toBe(0);
    expect(Number.isNaN(cierre?.csDiff ?? 0)).toBe(true);
  });
});
