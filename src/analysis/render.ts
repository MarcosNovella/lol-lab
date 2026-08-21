import type { Position } from '../riot/types.ts';
import type { CurvePoint } from './curve.ts';

/**
 * SVG for the two things text does badly (ADR-007): the gold curve against the lane opponent,
 * and the map of where he dies. Everything else stays text, because a line like "min 17:30 you
 * died alone with your team 3k up" is already the best form that fact has.
 *
 * Pure string building, no I/O, so it is testable — which matters more here than usual, because
 * a chart that is silently wrong looks exactly like a chart that is right.
 */

/**
 * Nominal Summoner's Rift bounds. Measured against the corpus before being trusted: across
 * 2493 kill events with positions, x runs 430..14153 and y 514..14247, so nothing clips.
 */
export const MAP_MAX = 14820;

/**
 * Projects a game position into SVG space, FLIPPING Y.
 *
 * League's y grows toward the top of the minimap; SVG's grows downward. Without the flip the
 * map comes out upside down, top lane reads as bot lane, and every conclusion drawn from it is
 * inverted — while looking perfectly plausible. Hence the test.
 */
export function mapPoint(position: Position, size: number): { cx: number; cy: number } {
  return {
    cx: (position.x / MAP_MAX) * size,
    cy: size - (position.y / MAP_MAX) * size,
  };
}

/**
 * Whether a position is on his own side of the map.
 *
 * The halfway line is the anti-diagonal `x + y = MAP_MAX`, which runs perpendicular to the mid
 * lane axis. Blue (team 100) spawns near the origin, red (200) near the far corner.
 *
 * NOTE ON WHAT IS *NOT* DONE HERE: positions are NOT mirrored to put his base in a fixed
 * corner. Summoner's Rift lanes are absolute and shared — bot lane is the same physical lane
 * for both teams — so rotating or reflecting the map to normalise "his side" would swap top and
 * bot lane identity while looking tidier. The team-relative fact is computed instead of moved.
 */
export function isOwnHalf(position: Position, teamId: number): boolean {
  const belowMidline = position.x + position.y < MAP_MAX;
  return teamId === 100 ? belowMidline : !belowMidline;
}

export type DeathDot = {
  position: Position;
  /** Team id he was on IN THAT GAME, so own-half is computed per game, not globally. */
  teamId: number;
  minute: number;
  /** Negative means the death cost gold. Drives the dot size. */
  costGold: number | null;
  label: string;
};

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The death map.
 *
 * `background` is the URL of the Rift minimap, and passing it changes the drawing from a grid
 * with dots into a map with dots: lanes, jungle camps and the river are then READ rather than
 * inferred from an anti-diagonal, which is the whole difference between "62% of his deaths are
 * near the mid axis" as a number and as a picture. It is optional because the static page has no
 * server to fetch it from (`lol page` writes one file and nothing else), and the grid version
 * has to stay correct on its own.
 */
export function deathMapSvg(
  deaths: DeathDot[],
  size = 520,
  background: string | null = null,
): string {
  const dots = deaths
    .map((death) => {
      const { cx, cy } = mapPoint(death.position, size);
      const own = isOwnHalf(death.position, death.teamId);
      // Cost drives radius. A death with no measurable window gets the base size rather than
      // vanishing, so coverage gaps stay visible.
      const cost = death.costGold === null ? 0 : Math.abs(Math.min(0, death.costGold));
      const r = 3 + Math.min(9, Math.sqrt(cost) / 12);
      const cls = own ? 'own' : 'enemy';
      return `<circle class="${cls}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"><title>${esc(
        `${death.minute}′ · ${own ? 'tu mitad' : 'mitad enemiga'} · ${death.label}`,
      )}</title></circle>`;
    })
    .join('\n');

  // With the photograph underneath, the guide lines get thinner and the plate darkens the image
  // so the dots stay the brightest thing on it — the map is context, the deaths are the subject.
  const base =
    background === null
      ? `  <rect class="plot" x="0" y="0" width="${size}" height="${size}" rx="6"/>`
      : `  <image href="${esc(background)}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="none"/>\n` +
        `  <rect class="mapveil" x="0" y="0" width="${size}" height="${size}" rx="6"/>`;

  // The half boundary stays in both versions — it is what "your half" MEANS and it is not
  // visible on the artwork. The base-to-base diagonal is dropped over the photo: it traces mid
  // lane, which the picture already draws better than a dashed line can.
  const guides =
    `  <line class="mid" x1="0" y1="${size}" x2="${size}" y2="0"/>` +
    (background === null ? `\n  <line class="half" x1="0" y1="0" x2="${size}" y2="${size}"/>` : '');

  return `<svg viewBox="0 0 ${size} ${size}" width="100%" role="img" aria-label="Mapa de muertes">
${base}
${guides}
  <text class="tag" x="8" y="${size - 8}">tu base (azul)</text>
  <text class="tag" x="${size - 8}" y="16" text-anchor="end">base enemiga (rojo)</text>
${dots}
</svg>`;
}

/**
 * The gold differential against the lane opponent over time.
 *
 * The zero line is drawn and the vertical scale is symmetric about it, because the whole
 * question is which side of zero the curve is on: an auto-scaled axis that puts zero near the
 * top edge makes a small lead look like domination.
 */
export function goldCurveSvg(points: CurvePoint[], width = 520, height = 200): string {
  if (points.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" width="100%"><text class="tag" x="8" y="20">sin datos</text></svg>`;
  }

  const pad = 28;
  const maxMinute = Math.max(...points.map((p) => p.minute));
  const extent = Math.max(500, ...points.map((p) => Math.abs(p.goldDiff)));
  const x = (minute: number): number => pad + (minute / maxMinute) * (width - pad * 2);
  const y = (gold: number): number => height / 2 - (gold / extent) * (height / 2 - pad / 2);

  const line = points.map((p) => `${x(p.minute).toFixed(1)},${y(p.goldDiff).toFixed(1)}`).join(' ');
  // Two circles per point. The visible one is 4.5px because a 3.5px dot is below the size a
  // marker needs to be read at a glance; the invisible one is 12px because a hit target must be
  // bigger than the mark it selects — chasing a 4px dot with a mouse is not an interaction.
  //
  // The `<title>` stays as the floor: it is what a reader gets with no JavaScript, in the static
  // page, and in a screen reader. The data attributes are what the panel's own tooltip reads,
  // and they are inert everywhere else.
  const dots = points
    .map((p) => {
      const cx = x(p.minute).toFixed(1);
      const cy = y(p.goldDiff).toFixed(1);
      const signed = `${p.goldDiff >= 0 ? '+' : ''}${p.goldDiff}`;
      return (
        `<circle class="${p.goldDiff >= 0 ? 'up' : 'down'}" cx="${cx}" cy="${cy}" r="4.5">` +
        `<title>${esc(`${p.minute}′ ${signed} de oro`)}</title></circle>` +
        `<circle class="hit" cx="${cx}" cy="${cy}" r="12" data-minuto="${p.minute}" ` +
        `data-oro="${p.goldDiff}" data-cs="${p.csDiff}" data-xp="${p.xpDiff}"/>`
      );
    })
    .join('\n');
  const ticks = points
    .map(
      (p) =>
        `<text class="tag" x="${x(p.minute).toFixed(1)}" y="${height - 4}" text-anchor="middle">${p.minute}′</text>`,
    )
    .join('\n');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Curva de oro">
  <line class="zero" x1="${pad}" y1="${height / 2}" x2="${width - pad}" y2="${height / 2}"/>
  <text class="tag" x="4" y="${height / 2 - 4}">0</text>
  <text class="tag" x="4" y="${pad / 2 + 4}">+${extent.toFixed(0)}</text>
  <text class="tag" x="4" y="${height - pad / 2}">-${extent.toFixed(0)}</text>
  <polyline class="curve" points="${line}"/>
${dots}
${ticks}
</svg>`;
}

/**
 * Una fila del gráfico de barras divergentes: una métrica, y de qué lado del rival caés.
 *
 * `effect` es el tamaño del efecto ya orientado — positivo SIEMPRE significa que él está mejor,
 * sin importar si la métrica sube o baja (morir menos es mejor). NaN es "no medible" y se dibuja
 * como tal en vez de como un cero, que es la sustitución que G-005 existe para frenar.
 */
export type MetricBar = {
  label: string;
  effect: number;
  /** Los dos números crudos, ya formateados por quien sabe la unidad: "68,2 vs 64,1". */
  detail: string;
  games: number;
};

/** Más allá de esto el tamaño del efecto es enorme igual, y una barra más larga no dice más. */
const EFFECT_CLAMP = 1.5;

/**
 * Barras divergentes ancladas en cero: dónde estás mejor y peor que TU RIVAL DE LÍNEA.
 *
 * Es la lectura que el panel no tenía y la que él pidió — entrar, mirar, y saber qué está
 * fallando. La forma es divergente porque el trabajo del dato es POLARIDAD: no "cuánto farmeo"
 * sino "de qué lado del rival caigo".
 *
 * Tres decisiones de dibujo, y ninguna es de gusto:
 *
 * - **La posición ya dice el signo.** Izquierda es peor, derecha es mejor, y el color solo lo
 *   repite. Por eso puede haber daltonismo en la sala y el gráfico se sigue leyendo.
 * - **Azul y naranja, no verde y rojo.** El par verde/rojo mide ΔE 7.9 bajo deuteranopía —
 *   apenas distinguible— contra 26.8 del azul/naranja, que pasa todos los checks. El verde y el
 *   rojo se quedan donde siempre llevan una palabra al lado ("victoria" / "DERROTA").
 * - **El largo es el TAMAÑO DEL EFECTO, no la diferencia cruda.** Una diferencia de 8 de CS y una
 *   de 0.3 de participación en kills no se comparan en la misma escala; en desvíos estándar sí.
 *   Se recorta en ±1.5 porque más allá de ahí la barra deja de agregar información.
 */
export function metricBarsSvg(rows: MetricBar[], width = 720): string {
  if (rows.length === 0) {
    return `<svg viewBox="0 0 ${width} 40" width="100%"><text class="tag" x="8" y="22">todavía no hay muestra suficiente</text></svg>`;
  }

  const gutter = 262;
  const rowH = 30;
  const barH = 13;
  const top = 22;
  const height = top + rows.length * rowH + 10;
  // 96 y no 82: con el ancho justo la barra más larga terminaba PEGADA al número, sin espacio
  // entre la marca y el texto que la explica.
  const plot = width - gutter - 96;
  const zero = gutter + plot / 2;
  const half = plot / 2;

  const x = (effect: number): number => {
    const clamped = Math.max(-EFFECT_CLAMP, Math.min(EFFECT_CLAMP, effect));
    return zero + (clamped / EFFECT_CLAMP) * half;
  };

  const barras = rows
    .map((row, i) => {
      const cy = top + i * rowH + rowH / 2;
      const y = cy - barH / 2;
      // Recortada si no entra en la canaleta, con el nombre completo en el tooltip. Una
      // etiqueta que se sale del viewBox se corta sin avisar y se lee como otra métrica: en la
      // primera versión "Ventaja de oro+XP en fase de líneas" aparecía como "ntaja de oro+XP…".
      const corta = row.label.length > 34 ? `${row.label.slice(0, 33)}…` : row.label;
      const etiqueta =
        `<text class="barlabel" x="${gutter - 10}" y="${cy + 4}" text-anchor="end">` +
        `${esc(corta)}</text>`;
      const titulo = `<title>${esc(`${row.label}: ${row.detail} · n=${row.games}`)}</title>`;

      if (!Number.isFinite(row.effect)) {
        // "No medible" se dibuja como texto y nunca como una barra de largo cero, que se leería
        // como "no hay diferencia" (G-005).
        return `<g>${titulo}${etiqueta}<text class="tag" x="${zero + 6}" y="${cy + 4}">sin dispersión para medirlo</text></g>`;
      }

      const fin = x(row.effect);
      const mejor = row.effect >= 0;
      const ancho = Math.max(2, Math.abs(fin - zero));
      const inicio = mejor ? zero : zero - ancho;
      // Extremo redondeado solo del lado que se aleja del cero: el cero es la línea base y una
      // barra redondeada de los dos lados flota en vez de anclarse.
      const r = Math.min(4, ancho);
      const d = mejor
        ? `M ${inicio} ${y} H ${inicio + ancho - r} A ${r} ${r} 0 0 1 ${inicio + ancho} ${y + r} V ${y + barH - r} A ${r} ${r} 0 0 1 ${inicio + ancho - r} ${y + barH} H ${inicio} Z`
        : `M ${inicio + ancho} ${y} H ${inicio + r} A ${r} ${r} 0 0 0 ${inicio} ${y + r} V ${y + barH - r} A ${r} ${r} 0 0 0 ${inicio + r} ${y + barH} H ${inicio + ancho} Z`;

      const valor =
        `<text class="barvalue" x="${width - 76}" y="${cy + 4}">` + `${esc(row.detail)}</text>`;
      return `<g>${titulo}${etiqueta}<path class="bar ${mejor ? 'mejor' : 'peor'}" d="${d}"/>${valor}</g>`;
    })
    .join('\n');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Dónde estás mejor y peor que tu rival de línea">
  <text class="tag" x="${zero - half}" y="12">peor que el rival</text>
  <text class="tag" x="${zero + half}" y="12" text-anchor="end">mejor que el rival</text>
  <line class="zero" x1="${zero}" y1="${top - 6}" x2="${zero}" y2="${height - 8}"/>
${barras}
</svg>`;
}

export type PhaseBar = {
  name: string;
  /** Lo suyo menos lo del rival de línea, en CS por minuto. NaN si no hay con qué comparar. */
  csDiff: number;
  /** Los dos números crudos, para que la diferencia nunca viaje sola. */
  detail: string;
  games: number;
  minutes: number;
};

/**
 * Las tres fases: dónde se te va la ventaja entre el minuto 0 y el final.
 *
 * Es la misma gramática que `metricBarsSvg` —cero en el medio, azul a la derecha, naranja a la
 * izquierda, extremo redondeado del lado que se aleja— pero NO la misma escala, y por eso es una
 * función aparte: acá el largo son CS por minuto de verdad, no un tamaño de efecto. Reusar aquel
 * builder habría puesto dos unidades distintas atrás de la misma longitud, que es exactamente
 * cómo un gráfico miente sin decir nada falso.
 *
 * La escala se calcula sobre los datos, con un piso de 1 CS/min: sin el piso, tres fases parejas
 * en 0.05 se dibujan como tres barras enormes.
 *
 * El número del rival va SIEMPRE al lado del suyo, porque todo esto está contaminado en el
 * sentido de G-008 — el que va gana rota y farmea menos después del 14 — y la diferencia sola se
 * leería como habilidad.
 */
export function phaseBarsSvg(rows: PhaseBar[], width = 720): string {
  const medibles = rows.filter((r) => Number.isFinite(r.csDiff));
  if (medibles.length === 0) {
    return `<svg viewBox="0 0 ${width} 40" width="100%"><text class="tag" x="8" y="22">todavía no hay partidas con timeline para separar las fases</text></svg>`;
  }

  const gutter = 150;
  const rowH = 34;
  const barH = 15;
  const top = 22;
  const height = top + rows.length * rowH + 10;
  const plot = width - gutter - 190;
  const zero = gutter + plot / 2;
  const half = plot / 2;
  const extent = Math.max(1, ...medibles.map((r) => Math.abs(r.csDiff)));

  const barras = rows
    .map((row, i) => {
      const cy = top + i * rowH + rowH / 2;
      const y = cy - barH / 2;
      const nombre =
        `<text class="barlabel" x="${gutter - 10}" y="${cy + 1}" text-anchor="end">` +
        `${esc(row.name)}</text>`;
      const bajo =
        `<text class="tag" x="${gutter - 10}" y="${cy + 14}" text-anchor="end">` +
        `${esc(row.games === 0 ? 'sin partidas' : `${row.games} partidas`)}</text>`;
      const titulo = `<title>${esc(`${row.name}: ${row.detail}`)}</title>`;

      if (!Number.isFinite(row.csDiff)) {
        return `<g>${titulo}${nombre}${bajo}<text class="tag" x="${zero + 6}" y="${cy + 4}">no llegaste a esta fase todavía</text></g>`;
      }

      const fin = zero + (row.csDiff / extent) * half;
      const mejor = row.csDiff >= 0;
      const ancho = Math.max(2, Math.abs(fin - zero));
      const inicio = mejor ? zero : zero - ancho;
      const r = Math.min(4, ancho);
      const d = mejor
        ? `M ${inicio} ${y} H ${inicio + ancho - r} A ${r} ${r} 0 0 1 ${inicio + ancho} ${y + r} V ${y + barH - r} A ${r} ${r} 0 0 1 ${inicio + ancho - r} ${y + barH} H ${inicio} Z`
        : `M ${inicio + ancho} ${y} H ${inicio + r} A ${r} ${r} 0 0 0 ${inicio} ${y + r} V ${y + barH - r} A ${r} ${r} 0 0 0 ${inicio + r} ${y + barH} H ${inicio + ancho} Z`;

      const signo = row.csDiff >= 0 ? '+' : '';
      const valor =
        `<text class="barvalue" x="${width - 184}" y="${cy + 1}">` +
        `${esc(`${signo}${row.csDiff.toFixed(2)} CS/min`)}</text>` +
        `<text class="tag" x="${width - 184}" y="${cy + 14}">${esc(row.detail)}</text>`;
      return `<g>${titulo}${nombre}${bajo}<path class="bar ${mejor ? 'mejor' : 'peor'}" d="${d}"/>${valor}</g>`;
    })
    .join('\n');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Tu ventaja de CS por fase, contra tu rival de línea">
  <text class="tag" x="${zero - half}" y="12">farmea más él</text>
  <text class="tag" x="${zero + half}" y="12" text-anchor="end">farmeás más vos</text>
  <line class="zero" x1="${zero}" y1="${top - 6}" x2="${zero}" y2="${height - 8}"/>
${barras}
</svg>`;
}

export type GrowthDot = {
  /** Posición dentro de la historia de ESTA cuenta. El eje x son partidas, no fechas. */
  index: number;
  mineRolling: number;
  theirsRolling: number;
  win: boolean;
};

/**
 * La curva de crecimiento: su media móvil contra la de su rival de línea, partida a partida.
 *
 * Dos series y NINGUNA línea de tendencia dibujada, que es la decisión que importa. Ajustar una
 * recta acá y dibujarla sería afirmar con una forma lo que el texto de al lado tiene que
 * retractar: sobre sus datos reales la pendiente es +0.083 / +0.030 / −0.015 según se suavice
 * con 5, 10 o 20 partidas — el signo CAMBIA, así que no hay tendencia que leer (G-025). El
 * número y su barrido van en la leyenda, donde se pueden calificar; el dibujo muestra las dos
 * series y deja que la forma hable.
 *
 * El rival va abajo como referencia y no como rival: es el nivel del lobby que le tocó (ADR-012),
 * que es lo único que separa "mejoré" de "me tocaron rivales peores". Por eso va en gris y
 * punteado — es el fondo contra el que se lee su línea, no una segunda cosa que compite.
 */
export function growthCurveSvg(dots: GrowthDot[], width = 720, height = 220): string {
  if (dots.length < 2) {
    return `<svg viewBox="0 0 ${width} 40" width="100%"><text class="tag" x="8" y="22">hacen falta al menos dos partidas para dibujar una curva</text></svg>`;
  }

  const padL = 34;
  const padR = 58;
  const padT = 16;
  const padB = 22;

  const valores = dots.flatMap((d) => [d.mineRolling, d.theirsRolling]).filter(Number.isFinite);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  // Un piso de rango: sin él, dos series que difieren en 0.2 llenan el alto y se leen como un
  // abismo. El eje se abre a lo que haya, nunca menos de esto.
  const span = Math.max(2, max - min);
  const centro = (max + min) / 2;
  const desde = centro - span / 2;
  const hasta = centro + span / 2;

  const x = (index: number): number => {
    const primero = dots[0]?.index ?? 0;
    const ultimo = dots[dots.length - 1]?.index ?? 1;
    const rango = Math.max(1, ultimo - primero);
    return padL + ((index - primero) / rango) * (width - padL - padR);
  };
  const y = (valor: number): number =>
    height - padB - ((valor - desde) / (hasta - desde)) * (height - padT - padB);

  const linea = (pick: (d: GrowthDot) => number): string =>
    dots
      .filter((d) => Number.isFinite(pick(d)))
      .map((d) => `${x(d.index).toFixed(1)},${y(pick(d)).toFixed(1)}`)
      .join(' ');

  const ultimo = dots[dots.length - 1];
  const etiquetas =
    ultimo === undefined
      ? ''
      : `<text class="serielabel mia" x="${(x(ultimo.index) + 6).toFixed(1)}" y="${(y(ultimo.mineRolling) + 4).toFixed(1)}">vos</text>` +
        `<text class="serielabel suya" x="${(x(ultimo.index) + 6).toFixed(1)}" y="${(y(ultimo.theirsRolling) + 4).toFixed(1)}">rival</text>`;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Tu media móvil contra la de tu rival de línea, partida a partida">
  <text class="tag" x="2" y="${(padT + 4).toFixed(1)}">${hasta.toFixed(1)}</text>
  <text class="tag" x="2" y="${(height - padB + 4).toFixed(1)}">${desde.toFixed(1)}</text>
  <text class="tag" x="${padL}" y="${height - 4}">partida ${dots[0]?.index ?? 1}</text>
  <text class="tag" x="${width - padR}" y="${height - 4}" text-anchor="end">${ultimo?.index ?? ''}</text>
  <polyline class="serie suya" points="${linea((d) => d.theirsRolling)}"/>
  <polyline class="serie mia" points="${linea((d) => d.mineRolling)}"/>
${etiquetas}
</svg>`;
}

/**
 * The matchup signature: every rep in grey, the mean on top.
 *
 * This is the EMPHASIS form, and it is the point of the drawing rather than its decoration. A
 * mean of eight games and a mean of eight games that all did the same thing are the same number
 * and different facts, so the individual curves are drawn instead of a standard deviation being
 * described in a caption nobody reads. What he sees is whether the shape is a shape.
 *
 * The mean line THINS where its `n` drops: games end, so the tail of a matchup curve is a
 * different and smaller sample than its head, and a line of constant weight says the opposite.
 */
export function signatureSvg(
  curvas: { puntos: { minute: number; goldDiff: number }[]; win: boolean }[],
  media: { minute: number; goldDiff: number; n: number }[],
  width = 520,
  height = 210,
): string {
  if (media.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" width="100%"><text class="tag" x="8" y="20">sin partidas medibles</text></svg>`;
  }

  const pad = 30;
  const minutos = media.map((p) => p.minute);
  const maxMinute = Math.max(...minutos);
  const todos = [
    ...curvas.flatMap((c) => c.puntos.map((p) => p.goldDiff)),
    ...media.map((p) => p.goldDiff),
  ];
  const extent = Math.max(500, ...todos.map((v) => Math.abs(v)));
  const x = (minute: number): number => pad + (minute / maxMinute) * (width - pad * 2);
  const y = (gold: number): number => height / 2 - (gold / extent) * (height / 2 - pad / 2);
  const nMax = Math.max(...media.map((p) => p.n));

  const fondo = curvas
    .map((c) => {
      if (c.puntos.length < 2) return '';
      const pts = c.puntos
        .map((p) => `${x(p.minute).toFixed(1)},${y(p.goldDiff).toFixed(1)}`)
        .join(' ');
      return `<polyline class="rep ${c.win ? 'gano' : 'perdio'}" points="${pts}"/>`;
    })
    .filter((l) => l !== '')
    .join('\n');

  // One segment per gap so each can carry its own weight. A single polyline cannot thin.
  const tramos = media
    .slice(1)
    .map((p, i) => {
      const a = media[i];
      if (a === undefined) return '';
      const n = Math.min(a.n, p.n);
      const grosor = (1.2 + 2.3 * (n / nMax)).toFixed(2);
      return `<line class="media" x1="${x(a.minute).toFixed(1)}" y1="${y(a.goldDiff).toFixed(1)}" x2="${x(p.minute).toFixed(1)}" y2="${y(p.goldDiff).toFixed(1)}" stroke-width="${grosor}"/>`;
    })
    .filter((l) => l !== '')
    .join('\n');

  const puntos = media
    .map(
      (p) =>
        `<circle class="mediaPunto" cx="${x(p.minute).toFixed(1)}" cy="${y(p.goldDiff).toFixed(1)}" r="4"><title>${esc(
          `${p.minute}′ ${p.goldDiff >= 0 ? '+' : ''}${p.goldDiff} de oro · ${p.n} partida${p.n === 1 ? '' : 's'}`,
        )}</title></circle>` +
        `<circle class="hit" cx="${x(p.minute).toFixed(1)}" cy="${y(p.goldDiff).toFixed(1)}" r="12" data-minuto="${p.minute}" data-oro="${p.goldDiff}" data-n="${p.n}"/>`,
    )
    .join('\n');

  // The n under each tick, because the denominator changing along the axis is the one thing a
  // reader cannot infer from the drawing and the one most likely to mislead them.
  const ticks = media
    .map(
      (p) =>
        `<text class="tag" x="${x(p.minute).toFixed(1)}" y="${height - 14}" text-anchor="middle">${p.minute}′</text>` +
        `<text class="tag dim" x="${x(p.minute).toFixed(1)}" y="${height - 3}" text-anchor="middle">n=${p.n}</text>`,
    )
    .join('\n');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Firma del matchup">
  <line class="zero" x1="${pad}" y1="${height / 2}" x2="${width - pad}" y2="${height / 2}"/>
  <text class="tag" x="4" y="${height / 2 - 4}">0</text>
  <text class="tag" x="4" y="${pad / 2 + 4}">+${extent.toFixed(0)}</text>
  <text class="tag" x="4" y="${height - pad}">-${extent.toFixed(0)}</text>
${fondo}
${tramos}
${puntos}
${ticks}
</svg>`;
}

/**
 * The CSS the SVG builders REQUIRE, and the variables it reads.
 *
 * Exported and shared, not copied. The builders emit `class="plot"`, `class="own"` and so on and
 * carry no presentation of their own, so an SVG pasted into a document that lacks these rules
 * renders with browser defaults: every fill black, on whatever background. That is not a
 * hypothetical — the UI reused `deathMapSvg` without this and produced a solid black square that
 * counted 188 deaths and showed none of them. `tests/render.test.ts` now asserts that every class
 * the builders emit has a rule here.
 */
export const SVG_STYLE = `
/* The signature. Every rep in the de-emphasis grey, the mean on top: it is the emphasis form,
   and the greys are what turn a mean into a shape somebody can judge. Win and loss are kept
   apart by a hair of tint only — the reading here is the SHAPE, and colouring the reps by result
   would invite reading the picture as "these are the ones I won". */
.rep { fill: none; stroke: #3a4152; stroke-width: 1; opacity: .55; }
.rep.gano { stroke: #40584a; }
.rep.perdio { stroke: #58414a; }
.media { stroke: var(--fg); stroke-linecap: round; }
.mediaPunto { fill: var(--fg); }
text.tag.dim { opacity: .55; }

/* Invisible hit targets. Without a rule they render as black discs over the whole chart — the
   builders carry no presentation of their own, which is exactly the G-023 trap. */
.hit { fill: transparent; cursor: crosshair; }

svg { display: block; max-width: 100%; }
rect.plot { fill: var(--plot); }
/* The veil over the minimap photo: without it the dots compete with the artwork. */
rect.mapveil { fill: #0b0d11; fill-opacity: .55; }
line.mid { stroke: var(--grid); stroke-width: 1.5; }
line.half { stroke: var(--grid); stroke-width: 1; stroke-dasharray: 4 4; }
line.zero { stroke: var(--grid); stroke-width: 1.5; }
polyline.curve { fill: none; stroke: var(--fg); stroke-width: 2; }
circle.up { fill: var(--up); } circle.down { fill: var(--down); }
/* Opaque enough to read over the minimap photo, and outlined so overlapping deaths stay
   countable instead of merging into one blob. */
circle.own { fill: var(--own); fill-opacity: .8; stroke: #0b0d11; stroke-opacity: .55; stroke-width: 1; }
circle.enemy { fill: var(--enemy); fill-opacity: .8; stroke: #0b0d11; stroke-opacity: .55; stroke-width: 1; }
text.tag { fill: var(--muted); font-size: 10px; paint-order: stroke; stroke: #0b0d11;
           stroke-width: 3px; stroke-linejoin: round; }
/* Las barras divergentes. El texto lleva tokens de texto y NUNCA el color de la barra: el color
   es identidad de la marca, no de la palabra que está al lado. */
path.bar.mejor { fill: var(--better); }
path.bar.peor  { fill: var(--worse); }
text.barlabel { fill: var(--fg); font-size: 12px; }
text.barvalue { fill: var(--muted); font-size: 11px; }
/* La curva de crecimiento. La suya es la línea; la del rival es el fondo contra el que se lee,
   así que va gris y punteada: es el nivel del lobby, no un contrincante (ADR-012). */
polyline.serie { fill: none; stroke-width: 2; }
polyline.serie.mia { stroke: var(--better); }
polyline.serie.suya { stroke: var(--grid); stroke-dasharray: 5 4; }
text.serielabel { font-size: 11px; }
text.serielabel.mia { fill: var(--better); }
text.serielabel.suya { fill: var(--muted); }
`;

/**
 * The dark palette `SVG_STYLE` reads, on its own.
 *
 * Exported separately because a host that has already committed to a dark page must not have its
 * charts follow the OS theme: the UI is dark by declaration, and without this the map came out
 * light-panelled inside a dark document on any machine whose system theme is light.
 */
export const SVG_VARS_DARK = `
:root {
  --fg: #e5e7eb; --muted: #9ca3af; --plot: #1a1d24;
  --grid: #374151; --up: #4ade80; --down: #f87171; --own: #60a5fa; --enemy: #f87171;
  /* Par divergente azul/naranja: pasa los seis checks contra este fondo, incluida la
     separación bajo daltonismo (ΔE 26.8 en protanopía, contra 7.9 del verde/rojo). */
  --better: #3987e5; --worse: #d95926;
}
`;

/** The variables `SVG_STYLE` reads, following the OS theme. For a page that has not picked one. */
export const SVG_VARS = `
:root {
  --fg: #1a1a1a; --muted: #6b7280; --plot: #f3f4f6;
  --grid: #d1d5db; --up: #15803d; --down: #b91c1c; --own: #2563eb; --enemy: #dc2626;
  --better: #2a78d6; --worse: #eb6834;
}
@media (prefers-color-scheme: dark) {
${SVG_VARS_DARK.replace(':root {', '  :root {').trimEnd()}
}
`;

const STYLE = `
:root { --bg: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1115; } }
${SVG_VARS}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-monospace, "Cascadia Code", Consolas, monospace;
}
h1 { font-size: 18px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 32px 0 8px; }
p.note { color: var(--muted); margin: 0 0 24px; max-width: 70ch; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
.card { border: 1px solid var(--grid); border-radius: 8px; padding: 12px; min-width: 0; }
.card h3 { font-size: 13px; margin: 0 0 8px; font-weight: 600; }
.card .meta { color: var(--muted); font-size: 12px; margin: 8px 0 0; }
${SVG_STYLE}
`;

export type PageSection = { title: string; meta: string; svg: string };

export function renderPage(options: {
  title: string;
  note: string;
  groups: { heading: string; sections: PageSection[] }[];
}): string {
  const groups = options.groups
    .map(
      (group) => `<h2>${esc(group.heading)}</h2>
<div class="grid">
${group.sections
  .map(
    (s) =>
      `<div class="card"><h3>${esc(s.title)}</h3>${s.svg}<p class="meta">${esc(s.meta)}</p></div>`,
  )
  .join('\n')}
</div>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${esc(options.title)}</h1>
<p class="note">${esc(options.note)}</p>
${groups}
</body>
</html>`;
}
