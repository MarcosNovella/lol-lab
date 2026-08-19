import type { Hypothesis } from './hypotheses.ts';

/**
 * El momento ANTES de jugar.
 *
 * Todo el ritual vive después de la sesión (`lol cerrar`, ADR-016): el motor solo habla cuando ya
 * no se puede hacer nada con lo que dice. Roadmap §3.2 quedó abierto por eso — nada le habla
 * antes de su primera ranked de la main, que es justo cuando más barato sale cambiar algo.
 *
 * Lo obvio sería mostrarle acá lo que el motor encontró. Lo obvio destruye el ledger. Cada fila
 * viva es una predicción que se está evaluando FUERA DE MUESTRA, y §4.8 ya dejó anotado que
 * contársela mezcla "el patrón era real" con "se lo dijeron y reaccionó", que después no se
 * separan. Un panel que se lo repite antes de cada partida convierte un "se lo conté una vez, en
 * una charla" en priming sistemático.
 *
 * De ahí las dos reglas que este módulo implementa, y que son la decisión de diseño entera:
 *
 * 1. FOCO SOLO DESDE EL LEDGER. Si algo no da para registrarse con una spec congelada, no da
 *    para decírselo antes de jugar. No hay lugar acá para un patrón recién visto.
 * 2. SE GASTA LO QUE NO SE PUEDE COBRAR. Una fila a la que le faltan 931 mediciones no va a
 *    resolverse en meses: callarla no compra un veredicto y decirla sí compra algo. Una a la que
 *    le faltan 20 está al alcance, y mostrarla quema la única medición limpia que va a tener.
 *    Las primeras se muestran, las segundas se GUARDAN — y el panel dice cuántas guardó, para que
 *    el silencio sea una decisión visible y no un hueco.
 *
 * Y lo que se muestra QUEDA ANOTADO (`briefing_exposures`), así una evaluación posterior puede
 * decir desde cuándo estuvo expuesto en vez de arrastrar la contaminación como nota al pie.
 *
 * Puro y sin I/O, como todo `src/analysis/*` (ADR-006): recibe hechos ya leídos y devuelve el
 * briefing. Quien lo llama es el que toca la base.
 */

// --------------------------------------------------------------------------- la pista

export type Urgencia = 'ahora' | 'cuando_puedas';

/** Algo que podría hacer ahora mismo, y por qué. */
export type Accion = {
  /** Id estable, para que la página enganche un botón sin machear contra la prosa. */
  id: 'taguear' | 'sync' | 'key' | 'resolver_cuenta';
  urgencia: Urgencia;
  que: string;
  porque: string;
};

export type RunwayFacts = {
  cuentas: { pendientes: number; ultimoSyncAt: number | null }[];
  key: { presente: boolean; probablementeVencida: boolean; problema: string | null };
  now: number;
};

/** Horas sin sincronizar a partir de las cuales la caché se declara vieja. */
export const HORAS_SIN_SYNC = 12;

/**
 * Lo que hay que arreglar, ordenado por lo que se pierde si no se arregla.
 *
 * Es la misma lista que el panel muestra como "qué hacer ahora" — una sola implementación, dos
 * encuadres. Antes de jugar se lee distinto: la key vencida no rompe la partida, rompe el sync
 * de después, y se arregla en treinta segundos AHORA en vez de a las tres de la mañana.
 */
export function runway(facts: RunwayFacts): Accion[] {
  const acciones: Accion[] = [];

  if (facts.cuentas.length === 0) {
    acciones.push({
      id: 'resolver_cuenta',
      urgencia: 'ahora',
      que: 'Registrar tu cuenta',
      porque: 'La caché está vacía: no hay ninguna cuenta resuelta todavía.',
    });
  }

  // Taguear va primero por lo mismo que va primero en el ritual: es el único insumo de acá que
  // no se puede recalcular mañana (ADR-015).
  const pendientes = facts.cuentas.reduce((n, c) => n + c.pendientes, 0);
  if (pendientes > 0) {
    acciones.push({
      id: 'taguear',
      urgencia: 'ahora',
      que: `Taguear ${pendientes} partida${pendientes === 1 ? '' : 's'}`,
      porque:
        'Es lo único que separa "jugué mal" de "me tocó mal", y una partida sin taguear no se ' +
        'puede taguear más adelante.',
    });
  }

  if (!facts.key.presente || facts.key.probablementeVencida) {
    acciones.push({
      id: 'key',
      urgencia: facts.key.presente ? 'cuando_puedas' : 'ahora',
      que: facts.key.presente ? 'Regenerar la key de Riot' : 'Pegar una key de Riot',
      porque: facts.key.problema ?? 'Sin key no se puede sincronizar.',
    });
  }

  // "Nunca sincronizada" y "sincronizada hace mucho" son hechos distintos y no pueden colapsar
  // uno en el otro. Mapear un sync ausente a 0 hace que `now - 0` sean quinientas mil horas: un
  // número plausible parado en el lugar de uno que no existe, que es la sustitución que G-005
  // existe para frenar.
  const nunca = facts.cuentas.some((c) => c.ultimoSyncAt === null);
  const fechas = facts.cuentas.flatMap((c) => (c.ultimoSyncAt === null ? [] : [c.ultimoSyncAt]));
  const masVieja = fechas.length === 0 ? null : Math.min(...fechas);
  const horas = masVieja === null ? null : (facts.now - masVieja) / 3_600_000;

  if (facts.cuentas.length > 0 && (nunca || (horas !== null && horas >= HORAS_SIN_SYNC))) {
    acciones.push({
      id: 'sync',
      urgencia: 'cuando_puedas',
      que: 'Sincronizar',
      porque: nunca
        ? 'Hay una cuenta que nunca se sincronizó.'
        : `Hace ${Math.floor(horas ?? 0)} h que no se baja nada.`,
    });
  }

  return acciones;
}

// --------------------------------------------------------------------------- el foco

/**
 * Cuántas mediciones más puede juntar en un horizonte que valga la pena esperar.
 *
 * A su volumen (~6-15 partidas por semana) son unos cuatro a siete meses. El número decide qué
 * fila se guarda y cuál se gasta, así que se barrió como cualquier otra perilla: sobre la forma
 * del ledger de hoy (faltantes de 20, 69, 270, 774 y 931) la partición es IDÉNTICA de 100 a 269
 * — se guardan las dos chicas, se gastan las tres grandes — y CAMBIA en 270, donde
 * `lead_conversion_gap` pasa a guardarse. 200 está adentro de ese rango insensible y no en el
 * borde, que es todo lo que se le puede pedir a una perilla así.
 *
 * El barrido está pinneado en `tests/briefing.test.ts` porque el borde importa: guardar una fila
 * a la que le faltan 270 mediciones es afirmar que su veredicto está al alcance, y a razón de
 * ~4 partidas-con-ventaja por sentada son más de ocho meses.
 */
export const HORIZON_GAMES = 200;

export type FocusCandidate = {
  id: string;
  claim: string;
  caveat: string;
  nNeeded: number;
  /**
   * n fuera de muestra de la última evaluación, o `null` si NUNCA se evaluó.
   *
   * null no es 0 y la diferencia decide: con 0 la fila parece lejísimos del veredicto y por lo
   * tanto gastable, cuando en realidad no se sabe cuánto acumuló. Es la misma sustitución que
   * G-005 y G-014 frenan en el resto del proyecto, salvo que acá el error es irreversible —
   * una exposición no se borra (G-029).
   */
  n: number | null;
  /** Cuándo se mostró por primera vez antes de jugar, o null si nunca. */
  exposedSince: number | null;
};

export type Focus = {
  id: string;
  claim: string;
  caveat: string;
  /** Mediciones que le faltan para poder dar un veredicto. */
  shortfall: number;
  /** Cuántas acumuló fuera de muestra. Un foco siempre viene de una fila ya evaluada. */
  n: number;
  alreadyExposed: boolean;
  /** Por qué esta fila se puede mostrar sin romper nada que valga la pena. */
  why: string;
};

/** Una fila viva que el briefing decide NO mostrar, y por qué. */
export type Withheld = {
  id: string;
  /** null cuando nunca se evaluó, que no es lo mismo que "no le falta nada". */
  shortfall: number | null;
  reason: 'al_alcance' | 'sin_evaluar';
};

export type FocusChoice = {
  focus: Focus | null;
  withheld: Withheld[];
  /** Por qué no hay foco, cuando no lo hay. Nunca un silencio sin explicación. */
  noFocusReason: string | null;
};

export function candidateFrom(
  hypothesis: Hypothesis,
  n: number | null,
  exposedSince: number | null,
) {
  return {
    id: hypothesis.id,
    claim: hypothesis.claim,
    caveat: hypothesis.caveat,
    nNeeded: hypothesis.nNeeded,
    n,
    exposedSince,
  } satisfies FocusCandidate;
}

/**
 * Elige una sola fila para mostrar, y guarda el resto.
 *
 * UNA, nunca tres. Un briefing con tres focos es un briefing sin foco, y cada fila extra gasta
 * otra medición limpia para comprar la misma atención dividida.
 *
 * El orden de preferencia es todo el argumento:
 *  1. Una fila YA EXPUESTA primero — mostrarla de nuevo no ensucia nada nuevo, la exposición ya
 *     está gastada y es irreversible.
 *  2. Después, la que más n acumuló fuera de muestra: es sobre la que más se midió.
 *  3. Desempate por id, para que la elección sea determinística y testeable.
 *
 * NO se ordena por tamaño del efecto: los efectos de este ledger están en unidades distintas
 * (una diferencia de winrate de 0.318 y una de oro de -139.4 no se comparan), y elegir por
 * magnitud entre unidades es exactamente el error que G-015 describe.
 */
export function pickFocus(
  candidates: FocusCandidate[],
  horizon: number = HORIZON_GAMES,
): FocusChoice {
  if (candidates.length === 0) {
    return {
      focus: null,
      withheld: [],
      noFocusReason:
        'El ledger no tiene ninguna fila viva: no hay predicción registrada que mostrar, y acá ' +
        'no se muestra nada que no esté registrado.',
    };
  }

  const conFaltante = candidates.map((c) => ({
    candidate: c,
    shortfall: c.n === null ? null : Math.max(0, c.nNeeded - c.n),
  }));

  // Gastable: o ya se gastó, o el veredicto está tan lejos que callarla no compra nada. Un
  // faltante de 0 es una fila que YA puede resolverse, y esa es la que menos hay que tocar; un
  // faltante DESCONOCIDO tampoco se gasta, porque la exposición no se puede deshacer.
  const gastables = conFaltante.filter(
    (x) => x.candidate.exposedSince !== null || (x.shortfall !== null && x.shortfall > horizon),
  );
  const guardadas: Withheld[] = conFaltante
    .filter((x) => !gastables.includes(x))
    .map((x) => ({
      id: x.candidate.id,
      shortfall: x.shortfall,
      reason: x.shortfall === null ? ('sin_evaluar' as const) : ('al_alcance' as const),
    }))
    .sort(
      (a, b) =>
        (a.shortfall ?? Number.POSITIVE_INFINITY) - (b.shortfall ?? Number.POSITIVE_INFINITY) ||
        a.id.localeCompare(b.id),
    );

  if (gastables.length === 0) {
    const detalle = guardadas
      .map((w) =>
        w.reason === 'sin_evaluar' ? `${w.id} (sin evaluar)` : `${w.id} (faltan ${w.shortfall})`,
      )
      .join(', ');
    const sinEvaluar = guardadas.filter((w) => w.reason === 'sin_evaluar').length;
    return {
      focus: null,
      withheld: guardadas,
      noFocusReason:
        `Las ${guardadas.length} filas vivas están fuera de lo que se puede gastar — ${detalle}` +
        (sinEvaluar > 0
          ? '. Una fila sin evaluar no se muestra: no se sabe cuánto acumuló y la exposición ' +
            'no se deshace; corré `lol hip evaluar` y volvé.'
          : ' — y mostrarte una antes de jugar arruina la única medición limpia que van a ' +
            'tener. El silencio de acá es la decisión, no un hueco.'),
    };
  }

  gastables.sort((a, b) => {
    const expuestaA = a.candidate.exposedSince === null ? 1 : 0;
    const expuestaB = b.candidate.exposedSince === null ? 1 : 0;
    if (expuestaA !== expuestaB) return expuestaA - expuestaB;
    const nA = a.candidate.n ?? 0;
    const nB = b.candidate.n ?? 0;
    if (nA !== nB) return nB - nA;
    return a.candidate.id.localeCompare(b.candidate.id);
  });

  const elegida = gastables[0];
  if (elegida === undefined) throw new Error('unreachable: gastables is not empty');
  const alreadyExposed = elegida.candidate.exposedSince !== null;
  // Una fila ya expuesta puede no haberse evaluado nunca: se gasta igual porque el gasto ya
  // ocurrió, y entonces el faltante que se muestra es el total.
  const shortfall = elegida.shortfall ?? elegida.candidate.nNeeded;

  return {
    focus: {
      id: elegida.candidate.id,
      claim: elegida.candidate.claim,
      caveat: elegida.candidate.caveat,
      shortfall,
      n: elegida.candidate.n ?? 0,
      alreadyExposed,
      why: alreadyExposed
        ? 'Ya te la había mostrado antes, así que volver a mostrarla no ensucia nada nuevo.'
        : 'Son muchas más de las que vas a juntar en meses: guardarla callada no compra un ' +
          'veredicto y decirla sí compra algo.',
    },
    withheld: guardadas,
    noFocusReason: null,
  };
}

// --------------------------------------------------------------------------- el briefing

export type ClockRow = {
  queue: string;
  text: string;
  wins: number | null;
  losses: number | null;
};

export type Silence = {
  /** Matchups sobre los que todavía no puede decir nada propio. */
  muted: number;
  total: number;
};

export type Briefing = {
  at: number;
  account: string;
  runway: Accion[];
  focus: Focus | null;
  withheld: Withheld[];
  noFocusReason: string | null;
  clock: ClockRow[];
  /** null cuando no se calculó, que no es lo mismo que cero matchups mudos. */
  silence: Silence | null;
};

export type BriefingInput = {
  at: number;
  account: string;
  /**
   * Ya construida por `runway()`, no los hechos crudos: el panel la calcula sobre TODAS las
   * cuentas y el CLI sobre la que va a jugar, y esa diferencia es del que llama. Pasarla armada
   * evita que este módulo tenga una opinión sobre un alcance que no le corresponde.
   */
  runway: Accion[];
  candidates: FocusCandidate[];
  clock: ClockRow[];
  silence: Silence | null;
  horizon?: number;
};

export function buildBriefing(input: BriefingInput): Briefing {
  const choice = pickFocus(input.candidates, input.horizon ?? HORIZON_GAMES);
  return {
    at: input.at,
    account: input.account,
    runway: input.runway,
    focus: choice.focus,
    withheld: choice.withheld,
    noFocusReason: choice.noFocusReason,
    clock: input.clock,
    silence: input.silence,
  };
}
