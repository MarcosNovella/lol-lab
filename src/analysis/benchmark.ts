import type { Db } from '../store/db.ts';
import { type MatchListRow, queryParticipants } from '../store/matches.ts';
import {
  type Contamination,
  type Distribution,
  METRICS,
  type Metric,
  type Role,
  roleLabel,
} from './metrics.ts';
import { cohensD, looksBinary, mean, median, percentileOf, round } from './stats.ts';

/**
 * "Where am I losing versus my own elo."
 *
 * The peer group is built from the other players in HIS OWN matches (ADR-002). Riot already
 * MMR-matched them to him, so this needs no external rank averages and costs no extra
 * requests. For a role-specific metric there is exactly one same-role peer per match — the
 * enemy laner — which also enables a paired comparison that controls for game length, patch
 * and lobby quality all at once.
 *
 * Honesty rules, same as athlete-os ADR-025: report effect size and n, never p-values. When
 * the sample is too small, say so instead of printing a confident-looking number.
 */

export const MIN_GAMES = 5;
export const MIN_PEERS = 5;

export type MetricComparison = {
  key: string;
  label: string;
  group: string;
  unit: string | null;
  higherIsBetter: boolean;
  contamination: Contamination;
  /**
   * The shape of the values AS OBSERVED in this sample, which can differ from what the
   * catalogue declares: a metric declared `magnitude` whose observations are all 0/1 is
   * reported here as the `flag` it turned out to be, and `notes` says so (G-009).
   */
  distribution: Distribution;
  /**
   * Whether this comparison is allowed to headline the report. False for a contaminated
   * metric read outside a stratum (G-008), and false for anything that is not a magnitude:
   * a 0/1 flag has no size to rank by, only a rate (G-009).
   */
  rankable: boolean;
  games: number;
  peers: number;
  yours: number;
  peerMean: number;
  peerMedian: number;
  diff: number;
  diffPct: number | null;
  /**
   * Where his average game sits inside the pile of peer games, 0-100.
   *
   * NULL for anything that is not a magnitude. A percentile over a 0/1 flag ranks him by how
   * OFTEN he trips it and then prints as though it ranked him by how much — which is exactly
   * the "percentil 97 en ventaja de oro+XP" that G-009 exists to prevent. For a flag the
   * honest numbers are already here: `yours` and `peerMean` are the two rates.
   */
  percentile: number | null;
  /**
   * Cohen's d, sign-flipped so positive ALWAYS means he is doing better.
   *
   * NaN when both distributions are constant — there is no spread to express the gap in.
   * NULL, and not computed at all, when the metric is not a magnitude: d over two Bernoullis
   * is defined arithmetically and means nothing anyone would read off it (G-009).
   */
  effect: number | null;
  /**
   * What the ranking sorts on. Equals `effect` whenever that is defined; when it is not,
   * falls back to the direction of the raw gap so a real difference between two tight
   * distributions is never reported as "even" (G-005).
   */
  score: number;
  /**
   * How he did against his direct counterpart, game by game. Null for role-agnostic metrics.
   * Ties are counted separately: several Riot metrics are ordinals that sit at 0 in most
   * games, and folding ties into losses makes a strong player look mediocre.
   */
  headToHead: { wins: number; ties: number; games: number; rate: number } | null;
  severity: 'crítico' | 'flojo' | 'parejo' | 'fuerte';
  enoughData: boolean;
};

export type BenchmarkResult = {
  account: string;
  role: Role | 'todos';
  queue: string;
  games: number;
  wins: number;
  winRate: number;
  window: { from: number | null; to: number | null };
  comparisons: MetricComparison[];
  weakest: MetricComparison[];
  strongest: MetricComparison[];
  notes: string[];
};

/**
 * Ranking score. Cohen's d when it exists; otherwise the direction of the raw gap.
 *
 * Zero pooled variance means every observation on both sides is identical. Cohen's d is
 * undefined there (divide by zero), but the gap between 5.0 and 7.0 CS/min is as real as a
 * gap gets — arguably more certain, since neither side ever deviated. Treating that as "no
 * effect" is the failure G-005 exists to prevent.
 */
export function scoreOf(effect: number, orientedDiff: number): number {
  if (Number.isFinite(effect)) return effect;
  if (orientedDiff === 0 || !Number.isFinite(orientedDiff)) return 0;
  // Sentinel large enough to sort to the extreme, finite enough to serialise.
  return Math.sign(orientedDiff) * 99;
}

function severityOf(score: number, enoughData: boolean): MetricComparison['severity'] {
  if (!enoughData || !Number.isFinite(score)) return 'parejo';
  if (score <= -0.5) return 'crítico';
  if (score <= -0.2) return 'flojo';
  if (score >= 0.5) return 'fuerte';
  return 'parejo';
}

function collect(rows: MatchListRow[], metric: Metric): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = metric.get(row);
    if (value !== null && Number.isFinite(value)) out.push(value);
  }
  return out;
}

export type BenchmarkOptions = {
  puuid: string;
  accountLabel: string;
  role?: Role;
  queueId?: number;
  queueLabel: string;
  since?: number;
  limit?: number;
  /**
   * Names the fixed game-state stratum the caller has already restricted the rows to, e.g.
   * "pareja al minuto 14". Supplying it is what unlocks ranking on contaminated metrics:
   * inside one stratum the snowball is held constant, so the mean stops measuring "when I
   * win, I win big". Passing a label for rows that were NOT actually restricted defeats
   * G-008 — the caller owns that contract.
   */
  stratum?: string;
};

export function benchmark(db: Db, options: BenchmarkOptions): BenchmarkResult {
  const mine = queryParticipants(db, {
    puuid: options.puuid,
    ...(options.role !== undefined ? { role: options.role } : {}),
    ...(options.queueId !== undefined ? { queueId: options.queueId } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });

  const notes: string[] = [];
  const matchIds = new Set(mine.map((r) => r.matchId));

  if (mine.length === 0) {
    return {
      account: options.accountLabel,
      role: options.role ?? 'todos',
      queue: options.queueLabel,
      games: 0,
      wins: 0,
      winRate: Number.NaN,
      window: { from: null, to: null },
      comparisons: [],
      weakest: [],
      strongest: [],
      notes: ['No hay partidas en la caché con esos filtros. Corré riot_sync primero.'],
    };
  }

  // Everyone else in the same matches. One query, then split per metric by role.
  const everyone = queryParticipants(db, {
    ...(options.queueId !== undefined ? { queueId: options.queueId } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
  }).filter((r) => matchIds.has(r.matchId) && r.puuid !== options.puuid);

  const myRoleByMatch = new Map(mine.map((r) => [r.matchId, r.teamPosition]));
  const myTeamByMatch = new Map(mine.map((r) => [r.matchId, r.teamId]));
  const myRowByMatch = new Map(mine.map((r) => [r.matchId, r]));

  const sameRolePeers = everyone.filter((r) => r.teamPosition === myRoleByMatch.get(r.matchId));
  const opponentByMatch = new Map<string, MatchListRow>();
  for (const peer of sameRolePeers) {
    if (peer.teamId !== myTeamByMatch.get(peer.matchId)) opponentByMatch.set(peer.matchId, peer);
  }

  const comparisons: MetricComparison[] = [];
  /** Metrics whose declared shape the data contradicted. Named in `notes`, never swallowed. */
  const demotedKeys: string[] = [];
  for (const metric of METRICS) {
    const peerRows = metric.roleSpecific ? sameRolePeers : everyone;
    const mineValues = collect(mine, metric);
    const peerValues = collect(peerRows, metric);

    if (mineValues.length === 0 || peerValues.length === 0) continue;

    const yours = mean(mineValues);
    const peerMean = mean(peerValues);

    // What the catalogue CLAIMS, checked against what arrived. A declaration about Riot's data
    // cannot be verified by `tsc`, so the sample gets a vote: a declared magnitude observed as
    // all-0/1 on both sides is demoted here and named in `notes` (G-009). Both sides, because
    // one side happening to be constant is a small sample, not a flag.
    const declared = metric.distribution;
    const demoted = declared === 'magnitude' && looksBinary(mineValues) && looksBinary(peerValues);
    const distribution: Distribution = demoted ? 'flag' : declared;
    if (demoted) demotedKeys.push(metric.label);
    const isMagnitude = distribution === 'magnitude';

    // Computed ONLY for a magnitude. Not computed and then hidden: a number that exists gets
    // read eventually, and these two are the pair that headlined a percentile over a flag.
    const rawEffect = isMagnitude ? cohensD(mineValues, peerValues) : Number.NaN;
    // Flip so a positive number always reads as "he is ahead", whatever the metric measures.
    const effect = metric.higherIsBetter ? rawEffect : -rawEffect;
    const rawPercentile = isMagnitude ? percentileOf(yours, peerValues) : Number.NaN;
    const percentile = metric.higherIsBetter ? rawPercentile : 100 - rawPercentile;
    const enoughData = mineValues.length >= MIN_GAMES && peerValues.length >= MIN_PEERS;

    let headToHead: MetricComparison['headToHead'] = null;
    if (metric.roleSpecific) {
      let wins = 0;
      let ties = 0;
      let games = 0;
      for (const [matchId, opponent] of opponentByMatch) {
        const myRow = myRowByMatch.get(matchId);
        if (!myRow) continue;
        const a = metric.get(myRow);
        const b = metric.get(opponent);
        if (a === null || b === null) continue;
        games += 1;
        if (a === b) ties += 1;
        else if (metric.higherIsBetter ? a > b : a < b) wins += 1;
      }
      // Rate is out of DECIDED games: a metric that ties in 24 of 36 games says nothing
      // about the 24, and counting them as losses would be a lie in the other direction.
      const decided = games - ties;
      if (games > 0) headToHead = { wins, ties, games, rate: decided > 0 ? wins / decided : 0 };
    }

    // Oriented so positive always means "better for him", matching `effect`.
    const orientedDiff = metric.higherIsBetter ? yours - peerMean : peerMean - yours;
    const score = scoreOf(effect, orientedDiff);

    comparisons.push({
      key: metric.key,
      label: metric.label,
      group: metric.group,
      unit: metric.unit ?? null,
      higherIsBetter: metric.higherIsBetter,
      contamination: metric.contamination,
      distribution,
      // Two independent gates, and a metric has to clear both. G-008 asks whether the number is
      // downstream of the result; G-009 asks whether it has a size at all. A causal flag passes
      // the first and fails the second, which is precisely the case that shipped.
      rankable: isMagnitude && (metric.contamination === 'causal' || options.stratum !== undefined),
      games: mineValues.length,
      peers: peerValues.length,
      yours: round(yours, metric.decimals),
      peerMean: round(peerMean, metric.decimals),
      peerMedian: round(median(peerValues), metric.decimals),
      diff: round(yours - peerMean, metric.decimals),
      diffPct: peerMean !== 0 ? round(((yours - peerMean) / Math.abs(peerMean)) * 100, 1) : null,
      percentile: isMagnitude ? round(percentile, 1) : null,
      effect: isMagnitude ? round(effect, 2) : null,
      score: round(score, 2),
      headToHead,
      severity: severityOf(score, enoughData),
      enoughData,
    });
  }

  // G-008 lives here. Without a stratum only causal metrics may be ranked, so a contaminated
  // metric can never again headline the report as a leak or as a strength — which is exactly
  // how "vision score is your worst metric" and "ahead in 17 of 18" both got published.
  const ranked = [...comparisons]
    .filter((c) => c.rankable && c.enoughData && Number.isFinite(c.score))
    .sort((a, b) => a.score - b.score);

  const wins = mine.filter((r) => r.win === 1).length;
  const creations = mine.map((r) => r.gameCreation);

  const thin = comparisons.filter((c) => !c.enoughData);
  if (thin.length > 0) {
    notes.push(
      `${thin.length} métrica(s) quedaron fuera del ranking por muestra chica ` +
        `(mínimo ${MIN_GAMES} partidas tuyas y ${MIN_PEERS} de referencia).`,
    );
  }
  // The two reasons a metric cannot be ranked are counted apart, because the answer to each is
  // different: a contaminated metric becomes rankable inside a stratum, a flag never does.
  const contaminated = comparisons.filter(
    (c) => !c.rankable && c.distribution === 'magnitude',
  ).length;
  if (contaminated > 0) {
    notes.push(
      `${contaminated} métrica(s) quedaron FUERA del ranking por estar contaminadas por el ` +
        'resultado: KDA, CS/min, daño, muertes y visión suben porque ganás, no al revés. ' +
        'Se muestran como descripción, nunca como fuga. Para poder rankearlas hay que ' +
        'fijar un estado de partida (por ejemplo, solo las partidas parejas al minuto 14).',
    );
  }
  const flags = comparisons.filter((c) => c.distribution !== 'magnitude');
  if (flags.length > 0) {
    notes.push(
      `${flags.length} métrica(s) son banderas 0/1, no magnitudes (${flags
        .map((c) => c.label)
        .join(', ')}): se informa la TASA con la que se prenden, sin percentil y sin tamaño ` +
        'de efecto. Un percentil sobre una bandera dice cuántas veces la prendés, nunca por ' +
        'cuánto, y así se publicó una vez un "percentil 97" que era una moneda (G-009).',
    );
  }
  if (demotedKeys.length > 0) {
    notes.push(
      `OJO: ${demotedKeys.join(', ')} está declarada como magnitud y en esta muestra sólo ` +
        'toma valores 0 y 1. La traté como bandera y la saqué del ranking; si la muestra ' +
        'crece y sigue binaria, corregí la declaración en metrics.ts.',
    );
  }
  notes.push(
    'La referencia son los otros jugadores de tus propias partidas, no un promedio de tu ' +
      'división sacado de otro lado. En las métricas por rol eso es tu rival de línea: es la ' +
      'comparación correcta para "dónde pierdo", pero no es una muestra aleatoria de tu elo.',
  );
  if (options.stratum !== undefined) {
    notes.push(
      `Estrato fijo: ${options.stratum}. Dentro de él el efecto bola de nieve está ` +
        'controlado, así que las métricas contaminadas vuelven a significar algo.',
    );
  }
  if (options.role === undefined) {
    notes.push(
      'Sin filtro de rol: las métricas por rol mezclan posiciones y pierden sentido. ' +
        'Pasá `role` para el diagnóstico de verdad.',
    );
  }

  return {
    account: options.accountLabel,
    role: options.role ?? 'todos',
    queue: options.queueLabel,
    games: mine.length,
    wins,
    winRate: round((wins / mine.length) * 100, 1),
    window: { from: Math.min(...creations), to: Math.max(...creations) },
    comparisons,
    weakest: ranked.slice(0, 3),
    strongest: ranked.slice(-3).reverse(),
    notes,
  };
}

/** Which role he actually plays, so the tool can default to it instead of asking. */
export function mostPlayedRole(db: Db, puuid: string, queueId?: number): Role | null {
  const rows = queryParticipants(db, {
    puuid,
    ...(queueId !== undefined ? { queueId } : {}),
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.teamPosition === '') continue;
    counts.set(row.teamPosition, (counts.get(row.teamPosition) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [role, count] of counts) {
    if (count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best as Role | null;
}

export function formatComparison(c: MetricComparison): string {
  const arrow = c.score > 0 ? '▲' : c.score < 0 ? '▼' : '=';
  const pct = c.unit === '%' ? (v: number) => `${round(v * 100, 1)}%` : (v: number) => String(v);
  const h2h = c.headToHead
    ? ` · vs rival de línea: ganás ${c.headToHead.wins} de ${c.headToHead.games - c.headToHead.ties} decididas` +
      (c.headToHead.ties > 0 ? ` (${c.headToHead.ties} empatadas)` : '')
    : '';
  // A flag gets a different sentence, not the same sentence with two fields blanked out. Its
  // mean IS a rate, so it is printed as one, and the percentile and the effect size that gave
  // G-009 its name simply do not appear (there is nothing to put in their place).
  if (c.distribution !== 'magnitude') {
    const rate = (v: number) => `${round(v * 100, 0)}%`;
    return (
      `${arrow} ${c.label} [bandera 0/1]: la prendés en ${rate(c.yours)} de tus partidas ` +
      `vs ${rate(c.peerMean)} la referencia (n=${c.games}/${c.peers})${h2h}`
    );
  }
  // Never print "NaN": say the effect size is undefined and why.
  const effect =
    c.effect !== null && Number.isFinite(c.effect)
      ? `efecto ${c.effect}`
      : 'efecto n/d (sin dispersión en la muestra)';
  return (
    `${arrow} ${c.label}: ${pct(c.yours)} vs ${pct(c.peerMean)} de referencia ` +
    `(percentil ${c.percentile}, ${effect}, n=${c.games}/${c.peers})${h2h}`
  );
}

export { roleLabel };
