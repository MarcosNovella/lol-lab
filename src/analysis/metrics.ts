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

export type Metric = {
  key: string;
  label: string;
  group: MetricGroup;
  higherIsBetter: boolean;
  roleSpecific: boolean;
  decimals: number;
  /** Null means Riot did not report it for this match; the metric skips that row. */
  get: (row: MatchListRow) => number | null;
  /** Rendered next to the number so the unit is never ambiguous. */
  unit?: string;
};

export const METRICS: Metric[] = [
  {
    key: 'cs_per_min',
    label: 'CS por minuto',
    group: 'economía',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.csPerMin,
  },
  {
    key: 'gold_per_min',
    label: 'Oro por minuto',
    group: 'economía',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 0,
    get: (r) => r.goldPerMin,
  },
  {
    key: 'cs_first_10',
    label: 'CS a los 10 minutos',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 1,
    get: (r) => r.csFirst10,
  },
  {
    key: 'max_cs_adv_on_lane',
    label: 'Máxima ventaja de CS sobre el rival de línea',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 1,
    get: (r) => r.maxCsAdvOnLane,
  },
  {
    key: 'early_lane_adv',
    label: 'Ventaja de oro+XP temprana',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.earlyLaneAdv,
  },
  {
    key: 'lane_adv',
    label: 'Ventaja de oro+XP en fase de líneas',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.laneAdv,
  },
  {
    key: 'turret_plates',
    label: 'Placas de torreta',
    group: 'línea',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.turretPlates,
  },
  {
    key: 'damage_per_min',
    label: 'Daño a campeones por minuto',
    group: 'daño',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 0,
    get: (r) => r.damagePerMin,
  },
  {
    key: 'team_damage_share',
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
    label: 'Daño recibido por minuto',
    group: 'daño',
    higherIsBetter: false,
    roleSpecific: true,
    decimals: 0,
    get: (r) => r.damageTakenPerMin,
  },
  {
    key: 'deaths_per_min',
    label: 'Muertes por minuto',
    group: 'peleas',
    higherIsBetter: false,
    roleSpecific: true,
    decimals: 3,
    get: (r) => r.deathsPerMin,
  },
  {
    key: 'kill_participation',
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
    label: 'KDA',
    group: 'peleas',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.kda,
  },
  {
    key: 'solo_kills',
    label: 'Solo kills',
    group: 'peleas',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.soloKills,
  },
  {
    key: 'vision_per_min',
    label: 'Vision score por minuto',
    group: 'visión',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.visionPerMin,
  },
  {
    key: 'control_wards',
    label: 'Guardianes de control comprados',
    group: 'visión',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.controlWards,
  },
  {
    key: 'wards_killed',
    label: 'Wards enemigas destruidas',
    group: 'visión',
    higherIsBetter: true,
    roleSpecific: true,
    decimals: 2,
    get: (r) => r.wardsKilled,
  },
  {
    key: 'damage_objectives',
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
