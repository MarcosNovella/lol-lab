import type { MatchDto, TimelineDto } from '../riot/types.ts';
import { championKills, participantsOf } from './events.ts';
import { frameAtMinute, laneStateAt } from './state.ts';

/**
 * The SHAPE of a game, rather than one frozen minute of it.
 *
 * `laneStateAt` answers "where was I at 14". This answers "where did the lead come from and
 * where did it go", which is a different question and the one a matchup note cannot hold:
 * against Akali the game may be even at 10, ahead at 14 and lost by 20, and only the shape
 * shows that.
 *
 * Everything here is measured against the lane opponent, so it inherits ADR-002's peer
 * definition for free: Riot MMR-matched them, no external rank average is needed.
 */

/** Minutes the curve is sampled at. Frames are one a minute, so these are exact readings. */
export const CURVE_MINUTES = [5, 10, 14, 20, 25, 30] as const;

export type CurvePoint = {
  minute: number;
  goldDiff: number;
  xpDiff: number;
  csDiff: number;
  teamGoldDiff: number;
};

export type StateCurve = {
  matchId: string;
  opponentChampion: string | null;
  points: CurvePoint[];
  /** Minutes the game never reached. Listed, so a short curve is visibly short. */
  missing: number[];
};

export function stateCurve(
  match: MatchDto,
  timeline: TimelineDto,
  puuid: string,
  minutes: readonly number[] = CURVE_MINUTES,
): StateCurve {
  const points: CurvePoint[] = [];
  const missing: number[] = [];
  let opponentChampion: string | null = null;

  for (const minute of minutes) {
    const state = laneStateAt(match, timeline, puuid, minute);
    if (state === null) {
      missing.push(minute);
      continue;
    }
    opponentChampion = state.opponentChampion;
    points.push({
      minute,
      goldDiff: state.goldDiff,
      xpDiff: state.xpDiff,
      csDiff: state.csDiff,
      teamGoldDiff: state.teamGoldDiff,
    });
  }

  return { matchId: match.metadata.matchId, opponentChampion, points, missing };
}

/**
 * Where the lead moved most, as a signed gold change between consecutive sampled minutes.
 *
 * Returns the widest swing and its window, which is the honest one-line summary of a shape:
 * "you gained 1800 between 10 and 14" or "you lost 2400 between 14 and 20".
 */
export function biggestSwing(
  curve: StateCurve,
): { from: number; to: number; delta: number } | null {
  let best: { from: number; to: number; delta: number } | null = null;
  for (let i = 1; i < curve.points.length; i += 1) {
    const previous = curve.points[i - 1];
    const current = curve.points[i];
    if (previous === undefined || current === undefined) continue;
    const delta = current.goldDiff - previous.goldDiff;
    if (best === null || Math.abs(delta) > Math.abs(best.delta)) {
      best = { from: previous.minute, to: current.minute, delta };
    }
  }
  return best;
}

// ------------------------------------------------------------------------------- phases

/**
 * The three phases the game actually has, as minute boundaries.
 *
 * 0-14 laning, 14-25 the mid game, 25+ the close. These are the same 14 the headline metric
 * uses, so a reader is not asked to hold two different definitions of "after laning".
 */
export const PHASES = [
  { name: 'línea', from: 0, to: 14 },
  { name: 'medio', from: 14, to: 25 },
  { name: 'cierre', from: 25, to: Number.POSITIVE_INFINITY },
] as const;

export type PhaseSplit = {
  name: string;
  from: number;
  /** Actual minutes of game inside this phase, so a 26-minute game does not divide by 11. */
  minutes: number;
  csPerMin: number;
  goldPerMin: number;
  deaths: number;
  kills: number;
  /** The lane opponent's CS per minute in the same phase, for the peer comparison. */
  opponentCsPerMin: number;
};

function csAt(
  timeline: TimelineDto,
  minute: number,
  participantId: number,
): { cs: number; gold: number } | null {
  const frame = frameAtMinute(timeline, minute);
  if (frame === null) return null;
  const pf = frame.participantFrames[String(participantId)];
  if (pf === undefined) return null;
  return {
    cs: (pf.minionsKilled ?? 0) + (pf.jungleMinionsKilled ?? 0),
    gold: pf.totalGold ?? 0,
  };
}

/**
 * Per-phase rates, his and his lane opponent's.
 *
 * Everything here is CONTAMINATED in the sense of G-008 — a player who is winning farms more in
 * the close — which is exactly why the opponent's value sits next to his instead of the number
 * standing alone. The plan wanted this for one specific question: what happens to his CS/min
 * between 14 and 25, which a season mean cannot show because the phases are averaged together.
 *
 * Damage per phase is deliberately absent: frames carry no damage, and summing
 * `victimDamageDealt` across kill events would count only the damage that happened to end in a
 * kill, which is not damage per minute and would read as if it were.
 */
export function phaseSplit(
  match: MatchDto,
  timeline: TimelineDto,
  puuid: string,
): PhaseSplit[] | null {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return null;
  const myId = participants.idOf(puuid);
  const me = match.info.participants.find((p) => p.puuid === puuid);
  if (myId === null || me === undefined || me.teamPosition === '') return null;

  const opponent = match.info.participants.find(
    (p) => p.teamPosition === me.teamPosition && p.teamId !== me.teamId,
  );
  const oppId = opponent ? participants.idOf(opponent.puuid) : null;

  // From the last frame's TIMESTAMP, not from how many frames there are (G-017). A timeline
  // appends a final partial frame, so a 24:01 game ships 26 frames: counting them says the
  // game lasted 25 minutes, minute 25 has no frame, and the whole 14-25 phase used to vanish.
  const lastFrame = timeline.info.frames.at(-1);
  if (lastFrame === undefined) return null;
  const lastWholeMinute = Math.floor(lastFrame.timestamp / 60_000);

  const kills = championKills(timeline);
  const out: PhaseSplit[] = [];

  for (const phase of PHASES) {
    const to = Math.min(phase.to, lastWholeMinute);
    const minutes = to - phase.from;
    if (minutes <= 0) continue;

    const mineStart = csAt(timeline, phase.from, myId);
    const mineEnd = csAt(timeline, to, myId);
    if (mineStart === null || mineEnd === null) continue;
    const oppStart = oppId === null ? null : csAt(timeline, phase.from, oppId);
    const oppEnd = oppId === null ? null : csAt(timeline, to, oppId);

    const inPhase = (timestamp: number): boolean =>
      timestamp >= phase.from * 60_000 && timestamp < to * 60_000;

    out.push({
      name: phase.name,
      from: phase.from,
      minutes,
      csPerMin: (mineEnd.cs - mineStart.cs) / minutes,
      goldPerMin: (mineEnd.gold - mineStart.gold) / minutes,
      deaths: kills.filter((e) => e.victimId === myId && inPhase(e.timestamp)).length,
      kills: kills.filter((e) => e.killerId === myId && inPhase(e.timestamp)).length,
      opponentCsPerMin:
        oppStart !== null && oppEnd !== null ? (oppEnd.cs - oppStart.cs) / minutes : Number.NaN,
    });
  }

  return out;
}

export type PhaseAverage = {
  name: string;
  from: number;
  /** Partidas que EFECTIVAMENTE llegaron a esta fase. Una de 22′ no cuenta en el cierre. */
  games: number;
  /** Minutos de juego realmente jugados adentro de la fase, sumados sobre esas partidas. */
  minutes: number;
  csPerMin: number;
  /** NaN cuando ninguna de esas partidas tuvo un rival de línea medible. */
  opponentCsPerMin: number;
  /** Lo suyo menos lo del rival. NaN si no hay con qué compararlo. */
  csDiff: number;
  deathsPer10: number;
};

/**
 * Promedia las fases sobre varias partidas.
 *
 * Dos cuidados que son toda la función:
 *
 * - **Cada fase tiene su propio n.** Una partida de 22 minutos aporta a línea y a medio y NO al
 *   cierre; contarla como un cierre de cero minutos hundiría el promedio de una fase que esa
 *   partida nunca jugó. `phaseSplit` ya no emite la fila, y acá cada fase cuenta las suyas.
 * - **Las tasas se promedian por MINUTO JUGADO, no por partida.** Un cierre de 3 minutos y uno
 *   de 20 no pesan igual; promediar las tasas crudas le daría al de 3 minutos el mismo voto y
 *   dejaría que un puñado de segundos mueva la fase entera.
 *
 * Lo que devuelve está CONTAMINADO en el sentido de G-008 y no se puede leer como habilidad: el
 * que va ganando rota y farmea menos después del 14. Por eso el número del rival viaja al lado
 * del suyo y nunca se devuelve solo — quien lo dibuje tiene que mostrar los dos.
 */
export function phaseAverages(perGame: PhaseSplit[][]): PhaseAverage[] {
  return PHASES.map((phase) => {
    const rows = perGame.flat().filter((r) => r.name === phase.name && r.minutes > 0);
    const minutes = rows.reduce((n, r) => n + r.minutes, 0);
    if (rows.length === 0 || minutes === 0) {
      return {
        name: phase.name,
        from: phase.from,
        games: 0,
        minutes: 0,
        csPerMin: Number.NaN,
        opponentCsPerMin: Number.NaN,
        csDiff: Number.NaN,
        deathsPer10: Number.NaN,
      };
    }

    const cs = rows.reduce((n, r) => n + r.csPerMin * r.minutes, 0) / minutes;
    const deaths = (rows.reduce((n, r) => n + r.deaths, 0) / minutes) * 10;

    // Solo las partidas donde el rival de línea era medible. Tratar un NaN como 0 acá diría que
    // el rival no farmeó nada, que es la sustitución que G-005 existe para frenar.
    const conRival = rows.filter((r) => Number.isFinite(r.opponentCsPerMin));
    const minutosConRival = conRival.reduce((n, r) => n + r.minutes, 0);
    const opponent =
      minutosConRival === 0
        ? Number.NaN
        : conRival.reduce((n, r) => n + r.opponentCsPerMin * r.minutes, 0) / minutosConRival;
    // La diferencia se calcula sobre las MISMAS partidas de las dos puntas, no contra el
    // promedio general suyo: si el rival falta en algunas, comparar contra otro denominador
    // mezcla dos muestras distintas (G-015).
    const mio =
      minutosConRival === 0
        ? Number.NaN
        : conRival.reduce((n, r) => n + r.csPerMin * r.minutes, 0) / minutosConRival;

    return {
      name: phase.name,
      from: phase.from,
      games: rows.length,
      minutes,
      csPerMin: cs,
      opponentCsPerMin: opponent,
      csDiff: mio - opponent,
      deathsPer10: deaths,
    };
  });
}
