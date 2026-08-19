import { describe, expect, it } from 'vitest';
import type { CurvePoint } from '../src/analysis/curve.ts';
import {
  type DeathDot,
  deathMapSvg,
  goldCurveSvg,
  isOwnHalf,
  MAP_MAX,
  type MetricBar,
  mapPoint,
  metricBarsSvg,
  phaseBarsSvg,
  renderPage,
  SVG_STYLE,
} from '../src/analysis/render.ts';
import { CLIENT_STYLE } from '../src/ui/page.ts';

describe('projecting a game position into SVG space', () => {
  it('FLIPS Y, so the enemy base is at the top of the picture', () => {
    // The defect this guards against draws the map upside down while looking plausible: top
    // lane would read as bot lane and every conclusion off the map would be inverted.
    const blueBase = mapPoint({ x: 0, y: 0 }, 500);
    const redBase = mapPoint({ x: MAP_MAX, y: MAP_MAX }, 500);
    expect(blueBase).toEqual({ cx: 0, cy: 500 });
    expect(redBase).toEqual({ cx: 500, cy: 0 });
  });

  it('puts the map centre at the centre', () => {
    const middle = mapPoint({ x: MAP_MAX / 2, y: MAP_MAX / 2 }, 500);
    expect(middle.cx).toBeCloseTo(250);
    expect(middle.cy).toBeCloseTo(250);
  });
});

describe('own half versus enemy half', () => {
  const nearBlueBase = { x: 2000, y: 2000 };
  const nearRedBase = { x: 12000, y: 12000 };

  it('reads the halfway line from the side he was on that game', () => {
    expect(isOwnHalf(nearBlueBase, 100)).toBe(true);
    expect(isOwnHalf(nearRedBase, 100)).toBe(false);
    expect(isOwnHalf(nearBlueBase, 200)).toBe(false);
    expect(isOwnHalf(nearRedBase, 200)).toBe(true);
  });

  it('keeps lane identity absolute — no mirroring', () => {
    // Bot lane is the same physical lane for both teams, so a position must NOT move when the
    // side changes. Only the own/enemy verdict flips.
    const botLane = { x: 11000, y: 2000 };
    expect(mapPoint(botLane, 500)).toEqual(mapPoint(botLane, 500));
    expect(isOwnHalf(botLane, 100)).toBe(true);
    expect(isOwnHalf(botLane, 200)).toBe(false);
  });
});

describe('the death map', () => {
  const dot = (over: Partial<DeathDot> = {}): DeathDot => ({
    position: { x: 7000, y: 7000 },
    teamId: 100,
    minute: 20,
    costGold: -2000,
    label: 'moriste solo',
    ...over,
  });

  it('draws one circle per death, tagged by half', () => {
    const svg = deathMapSvg([dot(), dot({ position: { x: 13000, y: 13000 } })]);
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(svg).toContain('class="own"');
    expect(svg).toContain('class="enemy"');
  });

  it('sizes a dot by cost but still draws one with no measurable cost', () => {
    const cheap = deathMapSvg([dot({ costGold: null })]);
    const dear = deathMapSvg([dot({ costGold: -9000 })]);
    const radius = (svg: string): number => Number(/r="([\d.]+)"/.exec(svg)?.[1] ?? 0);
    expect(radius(cheap)).toBeGreaterThan(0);
    expect(radius(dear)).toBeGreaterThan(radius(cheap));
  });

  it('escapes a label instead of letting it break the markup', () => {
    const svg = deathMapSvg([dot({ label: 'a <b> & "c"' })]);
    expect(svg).toContain('&lt;b&gt;');
    expect(svg).not.toContain('<b>');
  });

  it('produces a valid empty map rather than nothing', () => {
    const svg = deathMapSvg([]);
    expect(svg).toContain('<svg');
    expect(svg.match(/<circle/g)).toBeNull();
  });
});

describe('the gold curve', () => {
  const points: CurvePoint[] = [
    { minute: 5, goldDiff: -900, xpDiff: 0, csDiff: 0, teamGoldDiff: 0 },
    { minute: 10, goldDiff: -400, xpDiff: 0, csDiff: 0, teamGoldDiff: 0 },
    { minute: 14, goldDiff: 80, xpDiff: 0, csDiff: 0, teamGoldDiff: 0 },
    { minute: 20, goldDiff: 1200, xpDiff: 0, csDiff: 0, teamGoldDiff: 0 },
  ];

  it('scales symmetrically about zero, so a small lead cannot look like domination', () => {
    const svg = goldCurveSvg(points, 500, 200);
    // Zero sits on the horizontal midline of the plot, whatever the data does.
    expect(svg).toContain('y1="100"');
    expect(svg).toContain('+1200');
    expect(svg).toContain('-1200');
  });

  it('never lets the scale collapse on a near-even game', () => {
    const flat: CurvePoint[] = [
      { minute: 10, goldDiff: 5, xpDiff: 0, csDiff: 0, teamGoldDiff: 0 },
      { minute: 14, goldDiff: -3, xpDiff: 0, csDiff: 0, teamGoldDiff: 0 },
    ];
    // A floor on the extent keeps an 8-gold swing from being drawn as a cliff.
    expect(goldCurveSvg(flat)).toContain('500');
  });

  it('colours points by side of zero', () => {
    const svg = goldCurveSvg(points);
    expect(svg).toContain('class="down"');
    expect(svg).toContain('class="up"');
  });

  it('says so instead of drawing an empty axis', () => {
    expect(goldCurveSvg([])).toContain('sin datos');
  });
});

describe('the page', () => {
  it('is self-contained: no external stylesheet, script or image', () => {
    const html = renderPage({
      title: 'lol-lab',
      note: 'nota',
      groups: [{ heading: 'Curvas', sections: [{ title: 'g1', meta: 'm', svg: '<svg/>' }] }],
    });
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link|<script|https?:\/\//);
  });

  it('escapes titles that came from champion names or user text', () => {
    const html = renderPage({
      title: '<script>x</script>',
      note: 'n',
      groups: [],
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the SVGs carry no presentation of their own', () => {
  /** Every class the builders emit, from a drawing that exercises both of them. */
  function clasesEmitidas(): string[] {
    const dots: DeathDot[] = [
      { position: { x: 3000, y: 3000 }, teamId: 100, minute: 12, costGold: -400, label: 'a' },
      { position: { x: 12000, y: 12000 }, teamId: 100, minute: 20, costGold: null, label: 'b' },
    ];
    const points: CurvePoint[] = [
      { minute: 5, goldDiff: 300, xpDiff: 0, csDiff: 0, teamGoldDiff: 0 },
      { minute: 10, goldDiff: -300, xpDiff: 0, csDiff: 0, teamGoldDiff: 0 },
    ];
    // Both variants of the map: with the minimap photo underneath it emits `mapveil`, which is
    // a class like any other and needs a rule on both surfaces or the veil renders as an
    // opaque black plate over the picture.
    const svg =
      deathMapSvg(dots) +
      deathMapSvg(dots, 520, '/img/map/map11.png') +
      goldCurveSvg(points) +
      // Las tres variantes de la barra: mejor, peor y la que no se puede medir. Un builder que
      // no esté acá no está cubierto por esta garantía, que es exactamente cómo el mapa de
      // muertes llegó a producción como un cuadrado negro.
      metricBarsSvg([
        { label: 'CS a los 10', effect: 0.8, detail: '68,2 vs 64,1', games: 39 },
        { label: 'Muertes por minuto', effect: -0.5, detail: '0,18 vs 0,14', games: 39 },
        { label: 'Placas', effect: Number.NaN, detail: '2 vs 2', games: 39 },
      ]) +
      phaseBarsSvg([
        { name: 'línea', csDiff: 0.7, detail: '7,4 vs 6,7 CS/min', games: 39, minutes: 546 },
        { name: 'cierre', csDiff: -0.11, detail: '6,1 vs 6,2 CS/min', games: 12, minutes: 90 },
        { name: 'sin datos', csDiff: Number.NaN, detail: 'sin rival', games: 0, minutes: 0 },
      ]);
    // Separadas por espacio: un `class="bar mejor"` son DOS clases, y buscarlo entero no
    // encuentra la regla `path.bar.mejor` aunque exista.
    return [
      ...new Set([...svg.matchAll(/class="([^"]+)"/g)].flatMap((m) => (m[1] ?? '').split(/\s+/))),
    ].filter((c) => c !== '');
  }

  it('every emitted class has a rule in the shared stylesheet', () => {
    // The builders emit `class="own"` and carry no fill, so an SVG dropped into a document
    // without these rules renders with browser defaults: black on whatever background. That is
    // not hypothetical — the UI reused deathMapSvg without this stylesheet and produced a solid
    // black square that counted 188 deaths and displayed none of them.
    for (const clase of clasesEmitidas()) {
      expect(SVG_STYLE, `falta una regla para .${clase}`).toContain(`.${clase}`);
    }
  });

  it('the UI page includes that stylesheet, not a copy of it', () => {
    // Both surfaces must pull from the same source, or they drift and only one of them is
    // noticed to be wrong.
    expect(CLIENT_STYLE).toContain(SVG_STYLE.trim().split('\n')[0] ?? '');
    for (const clase of clasesEmitidas()) {
      expect(CLIENT_STYLE, `la UI no estila .${clase}`).toContain(`.${clase}`);
    }
  });
});

describe('el mapa con el minimapa de fondo', () => {
  const dots: DeathDot[] = [
    { position: { x: 3000, y: 3000 }, teamId: 100, minute: 12, costGold: -400, label: 'a' },
  ];

  it('draws the photograph and veils it, only when a background is given', () => {
    const sinFoto = deathMapSvg(dots);
    expect(sinFoto).toContain('class="plot"');
    expect(sinFoto).not.toContain('<image');

    const conFoto = deathMapSvg(dots, 520, '/img/map/map11.png');
    expect(conFoto).toContain('<image href="/img/map/map11.png"');
    expect(conFoto).toContain('class="mapveil"');
    // The plate replaces the flat background rather than sitting on top of it.
    expect(conFoto).not.toContain('class="plot"');
    // And the deaths are still drawn over both.
    expect(conFoto).toContain('class="own"');
  });

  it('escapes the URL, since it lands inside an attribute', () => {
    expect(deathMapSvg(dots, 520, '/img/map/x".png')).toContain('x&quot;.png');
  });
});

describe('las barras divergentes', () => {
  const fila = (over: Partial<MetricBar> & { label: string }): MetricBar => ({
    effect: 0.5,
    detail: '1,0 vs 0,5',
    games: 12,
    ...over,
  });

  it('manda la barra a la derecha cuando está mejor y a la izquierda cuando está peor', () => {
    const svg = metricBarsSvg([
      fila({ label: 'mejor', effect: 1 }),
      fila({ label: 'peor', effect: -1 }),
    ]);
    expect(svg).toContain('class="bar mejor"');
    expect(svg).toContain('class="bar peor"');
  });

  it('NO dibuja una barra cuando el efecto no es medible', () => {
    // Una barra de largo cero se lee como "no hay diferencia", que es lo contrario de "no se
    // puede medir" (G-005).
    const svg = metricBarsSvg([fila({ label: 'sin dispersión', effect: Number.NaN })]);
    // `class="bar` a secas también matchea `class="barlabel"`, que está en TODAS las filas.
    expect(svg).not.toContain('class="bar mejor"');
    expect(svg).not.toContain('class="bar peor"');
    expect(svg).toContain('sin dispersión para medirlo');
  });

  it('recorta un efecto enorme en vez de dibujar fuera del gráfico', () => {
    const normal = metricBarsSvg([fila({ label: 'a', effect: 1.5 })]);
    const enorme = metricBarsSvg([fila({ label: 'a', effect: 40 })]);
    // Misma geometría: más allá del tope la barra no puede seguir creciendo.
    expect(enorme).toBe(normal);
  });

  it('recorta la etiqueta larga y guarda el nombre entero en el tooltip', () => {
    const largo = 'Ventaja de oro y experiencia en la fase de líneas completa';
    const svg = metricBarsSvg([fila({ label: largo })]);
    expect(svg).not.toContain(`>${largo}<`);
    expect(svg).toContain('…');
    // El nombre completo sigue estando: se lee pasando el mouse, no se pierde.
    expect(svg).toContain(largo);
  });

  it('dice que no hay muestra en vez de dibujar un gráfico vacío', () => {
    expect(metricBarsSvg([])).toContain('todavía no hay muestra suficiente');
  });
});
