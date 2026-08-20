import type { MatchListRow } from '../store/matches.ts';

/**
 * The metric catalogue the benchmark walks.
 *
 * `higherIsBetter` matters: for deaths per minute and damage taken, being ABOVE the peers is
 * the problem, and the report has to rank those the other way round or it will congratulate
 * him for dying more than everyone else.
 *
 * `roleSpecific` marks metrics that may only be compared against the same role. In League
 * that is ALL of them (G-007). Vision score looked like the exception until a mid laner got
 * benchmarked against a pool containing supports, who carry two to three times the vision
 * score by design: it came out as his single worst metric and headlined the report, purely
 * as an artefact of the pool. Deaths per minute, kill participation and KDA are just as
 * role-conditioned. The flag stays so a genuine exception can be marked, but the default is
 * true and widening a pool to buy sample size is how you manufacture a false finding.
 */

export type MetricGroup = 'economía' | 'daño' | 'línea' | 'visión' | 'peleas' | 'objetivos';

/**
 * Whether a metric can be read as a cause of the result or only as a symptom of it (G-008).
 *
 * - `causal`      measured before the outcome is decided, so its mean means something on its
 *                 own. In practice: anything that stops accruing by the end of laning phase.
 * - `contaminated` downstream of winning. A player who snowballs farms more, deals more damage
 *                 and dies less BECAUSE he is winning, so an unconditioned mean over these
 *                 measures "when I win, I win big" and nothing else. Reportable ONLY split by
 *                 result or inside a fixed game-state stratum.
 * - `conditional`  only means anything given a state ("conversion from +1500 gold at 14").
 *
 * This is the single lesson of the first benchmark: it reported him ahead of his lane
 * opponent in 17 of 18 metrics while his win rate was 52.8%, because 14 of those 18 are
 * contaminated and his stomps dominated every mean. Note how few metrics survive as causal —
 * that scarcity is the honest picture, not a gap in the catalogue.
 */
export type Contamination = 'causal' | 'contaminated' | 'conditional';

/**
 * The SHAPE of the values, which is a different question from what they measure (G-009).
 *
 * - `magnitude` a real quantity: a mean, a percentile and an effect size all say something.
 * - `flag`      a 0/1 indicator. Its mean is a RATE and reads fine; a percentile over it says
 *               only "he trips it more often than his peers", never BY HOW MUCH, and Cohen's d
 *               over two Bernoullis is a number that looks like an effect size and is not one.
 * - `ordinal`   ranked categories with no fixed spacing, so the arithmetic is not defined.
 *
 * Required, never defaulted, for the same reason `contamination` is: `laningPhaseGoldExpAdvantage`
 * is a flag (0 in 24 games, 1 in 12) and was reported as "percentil 97 en ventaja de oro+XP en
 * línea". G-009 was written the day that shipped and stayed a rule in a markdown file for two
 * days; this field is the rule made structural.
 *
 * The declaration is a CLAIM ABOUT RIOT'S DATA and this project has no way to verify it at
 * compile time, so `benchmark()` re-checks every declared `magnitude` against the sample it
 * actually has (`looksBinary`) and demotes it — with a note — when the data disagrees. Declaring
 * one wrong costs a note, never a false percentile.
 */
export type Distribution = 'magnitude' | 'flag' | 'ordinal';

export type Metric = {
  key: string;
  label: string;
  group: MetricGroup;
  higherIsBetter: boolean;
  roleSpecific: boolean;
  /** Required, never defaulted: a new metric must be classified deliberately (G-008). */
  contamination: Contamination;
  /** Required, never defaulted: only a `magnitude` may be ranked or given a percentile (G-009). */
  distribution: Distribution;
  decimals: number;
  /** Null means Riot did not report it for this match; the metric skips that row. */
  get: (row: MatchListRow) => number | null;
  /** Rendered next to the number so the unit is never ambiguous. */
  unit?: string;
};

export const METRICS: Metric[] = [
  {
    key: 'cs_per_min',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'CS por minuto',
    group: 'economía',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.csPerMin,
  },
  {
    key: 'gold_per_min',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Oro por minuto',
    group: 'economía',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 0,
    get: (r) => r.goldPerMin,
  },
  {
    key: 'cs_first_10',
    distribution: 'magnitude',
    contamination: 'causal',
    label: 'CS a los 10 minutos',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 1,
    get: (r) => r.csFirst10,
  },
  {
    key: 'max_cs_adv_on_lane',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Máxima ventaja de CS sobre el rival de línea',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 1,
    get: (r) => r.maxCsAdvOnLane,
  },
  {
    key: 'early_lane_adv',
    // Riot's `earlyLaningPhaseGoldExpAdvantage`: a 0/1 flag, not a magnitude (G-009).
    distribution: 'flag',
    contamination: 'causal',
    label: 'Ventaja de oro+XP temprana',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.earlyLaneAdv,
  },
  {
    key: 'lane_adv',
    // Riot's `laningPhaseGoldExpAdvantage`: a 0/1 flag, and it matched
    // `early_lane_adv` in all 36 games of the corpus it was measured on — the same signal twice.
    distribution: 'flag',
    contamination: 'causal',
    label: 'Ventaja de oro+XP en fase de líneas',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.laneAdv,
  },
  {
    key: 'turret_plates',
    distribution: 'magnitude',
    contamination: 'causal',
    label: 'Placas de torreta',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.turretPlates,
  },
  {
    key: 'damage_per_min',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Daño a campeones por minuto',
    group: 'daño',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 0,
    get: (r) => r.damagePerMin,
  },
  {
    key: 'team_damage_share',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Porcentaje del daño del equipo',
    group: 'daño',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 3,
    unit: '%',
    get: (r) => r.teamDamageShare,
  },
  {
    key: 'damage_taken_per_min',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Daño recibido por minuto',
    group: 'daño',
    higherIsBetter: false,
    roleSpecific: true,
    decimals: 0,
    get: (r) => r.damageTakenPerMin,
  },
  {
    key: 'deaths_per_min',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Muertes por minuto',
    group: 'peleas',
    higherIsBetter: false,
    roleSpecific: true,
    decimals: 3,
    get: (r) => r.deathsPerMin,
  },
  {
    key: 'kill_participation',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Participación en kills',
    group: 'peleas',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 3,
    unit: '%',
    get: (r) => r.killParticipation,
  },
  {
    key: 'kda',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'KDA',
    group: 'peleas',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.kda,
  },
  {
    key: 'solo_kills',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Solo kills',
    group: 'peleas',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.soloKills,
  },
  {
    key: 'vision_per_min',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Vision score por minuto',
    group: 'visión',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.visionPerMin,
  },
  {
    key: 'control_wards',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Guardianes de control comprados',
    group: 'visión',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.controlWards,
  },
  {
    key: 'wards_killed',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Wards enemigas destruidas',
    group: 'visión',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.wardsKilled,
  },
  {
    key: 'damage_objectives',
    distribution: 'magnitude',
    contamination: 'contaminated',
    label: 'Daño a objetivos por partida',
    group: 'objetivos',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 0,
    get: (r) => r.damageObjectives,
  },
];

export const METRICS_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value.toUpperCase());
}

/** Accepts the names a human actually types and maps them to Riot's `teamPosition`. */
const ROLE_ALIASES: Record<string, Role> = {
  top: 'TOP',
  jungle: 'JUNGLE',
  jungla: 'JUNGLE',
  jg: 'JUNGLE',
  mid: 'MIDDLE',
  middle: 'MIDDLE',
  medio: 'MIDDLE',
  adc: 'BOTTOM',
  bot: 'BOTTOM',
  bottom: 'BOTTOM',
  tirador: 'BOTTOM',
  support: 'UTILITY',
  soporte: 'UTILITY',
  supp: 'UTILITY',
  utility: 'UTILITY',
};

export function normaliseRole(value: string): Role | null {
  return ROLE_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function roleLabel(role: Role): string {
  const labels: Record<Role, string> = {
    TOP: 'top',
    JUNGLE: 'jungla',
    MIDDLE: 'mid',
    BOTTOM: 'ADC',
    UTILITY: 'soporte',
  };
  return labels[role];
}
