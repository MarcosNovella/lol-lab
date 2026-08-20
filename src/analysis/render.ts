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
}
`;

/** The variables `SVG_STYLE` reads, following the OS theme. For a page that has not picked one. */
export const SVG_VARS = `
:root {
  --fg: #1a1a1a; --muted: #6b7280; --plot: #f3f4f6;
  --grid: #d1d5db; --up: #15803d; --down: #b91c1c; --own: #2563eb; --enemy: #dc2626;
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
