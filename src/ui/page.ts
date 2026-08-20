/**
 * The page itself: one HTML document with its CSS and JS inline.
 *
 * No framework and no build step, consistent with ADR-003 and with ADR-014's reasoning for the
 * static page — a panel with buttons over a local JSON API is not a thing that needs a bundler.
 * The document is a SHELL: it ships no data, and everything it shows comes from /api/*, so
 * there is exactly one place where each number is produced.
 *
 * The layout is PROGRESSIVE DISCLOSURE and that is a decision, not a style (ADR-024). One card
 * says what to do now; everything else is a collapsed section that renders the first time it is
 * opened. The panel used to paint nine sections at once — the whole engine at full volume, which
 * is the shape of a report and not of a thing you use after playing at two in the morning.
 */

import { SVG_STYLE, SVG_VARS_DARK } from '../analysis/render.ts';

/** Exported so a test can assert it carries the rules the SVG builders need. */
export const CLIENT_STYLE = `
:root {
  color-scheme: dark;
  --bg: #0d0f14;
  --card: #161922;
  --card-2: #1c2029;
  --line: #262b36;
  --line-soft: #1f242e;
  --ink: #e8eaf0;
  --dim: #98a1b0;
  --faint: #6b7482;
  --ok: #5ec27a;
  --warn: #e0b450;
  --bad: #e06c6c;
  --accent: #6ea8fe;
  --r-sm: 6px;
  --r: 10px;
  --r-lg: 14px;
  --gap: 10px;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 20px 80px;
  background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 980px; margin: 0 auto; }
h1 { font-size: 17px; margin: 0; letter-spacing: -.01em; }
h3 { font-size: 13px; margin: 16px 0 8px; color: var(--dim); font-weight: 600;
     text-transform: uppercase; letter-spacing: .07em; }
.sub { color: var(--faint); font-size: 12px; margin: 0; }
.dim { color: var(--dim); }
.faint { color: var(--faint); }
.ok { color: var(--ok); }
.bad { color: var(--bad); }
.warn { color: var(--warn); }
.nums { font-variant-numeric: tabular-nums; }

/* ---------------------------------------------------------------- barra superior
   Sticky because the scope selectors live in it: the reader must always be able to see
   WHICH account and role every number below is about, without scrolling back up. */
.top { position: sticky; top: 0; z-index: 20; background: var(--bg);
       padding: 14px 0 10px; margin-bottom: 4px; border-bottom: 1px solid var(--line-soft); }
.top .fila { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.top .marca { display: flex; flex-direction: column; margin-right: auto; }
.scope { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.scope .sep { color: var(--line); }

/* Chips: the account switcher and every filter. A button that looks like what it is. */
.chip { font: inherit; font-size: 13px; color: var(--dim); background: transparent;
        border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px;
        cursor: pointer; white-space: nowrap; }
.chip:hover { background: var(--card-2); color: var(--ink); }
.chip[aria-pressed="true"] { background: #24304a; border-color: var(--accent); color: #cfe0ff; }
.chip .n { color: var(--faint); font-size: 11px; margin-left: 5px; }

select {
  font: inherit; font-size: 13px; color: var(--dim); background: var(--card);
  border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; cursor: pointer;
}
select:hover { color: var(--ink); }

/* --------------------------------------------------------------------- tarjetas */
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r);
        padding: 14px 16px; margin-bottom: var(--gap); }
.card.plano { background: transparent; border-color: var(--line-soft); }
.err { border-color: var(--bad); }

/* ------------------------------------------------------------------- lo de ahora
   The one card that is never collapsed. Everything else on the page is a detail; this is
   the answer to the only question the panel exists to answer. */
.destacada { display: flex; gap: 14px; align-items: flex-start;
         background: linear-gradient(180deg, #1b2030, var(--card));
         border: 1px solid #2c3446; border-radius: var(--r-lg); padding: 16px 18px;
         margin-bottom: 14px; }
.destacada .txt { flex: 1; min-width: 0; }
.destacada .que { font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
.destacada .porque { color: var(--dim); font-size: 13px; margin-top: 4px; }
.destacada .marca { font-size: 11px; font-weight: 700; letter-spacing: .08em;
                text-transform: uppercase; padding: 3px 8px; border-radius: var(--r-sm);
                flex: none; margin-top: 2px; }
.destacada .marca.urg-ahora { background: #3a1f22; color: #ffb3b3; }
.destacada .marca.urg-cuando_puedas { background: #392f19; color: #ffdf9e; }
.destacada .acciones { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.otras { display: flex; flex-direction: column; gap: 4px; margin: -4px 0 14px; padding-left: 2px; }
.otras .otra { color: var(--dim); font-size: 13px; display: flex; gap: 9px; align-items: center; }
.otras .punto { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.punto.urg-ahora { background: var(--bad); }
.punto.urg-cuando_puedas { background: var(--warn); }

/* -------------------------------------------------------------------- colapsables
   A native <details> on purpose: it is keyboard-accessible, it survives with JavaScript off, and
   the browser already knows how to animate it. The badge in the summary is what makes a
   closed section honest — collapsed must not mean blind. */
details.seccion { border: 1px solid var(--line); border-radius: var(--r);
                  background: var(--card); margin-bottom: var(--gap); overflow: hidden; }
details.seccion > summary {
  list-style: none; cursor: pointer; padding: 12px 16px;
  display: flex; align-items: center; gap: 10px; user-select: none;
}
details.seccion > summary::-webkit-details-marker { display: none; }
details.seccion > summary:hover { background: var(--card-2); }
details.seccion > summary .titulo { font-weight: 600; font-size: 14px; }
details.seccion > summary .resumen { color: var(--faint); font-size: 12px; margin-left: auto;
                                     text-align: right; }
details.seccion > summary .flecha { color: var(--faint); transition: transform .15s;
                                    font-size: 11px; width: 10px; }
details.seccion[open] > summary .flecha { transform: rotate(90deg); }
details.seccion[open] > summary { border-bottom: 1px solid var(--line-soft); }
.cuerpo { padding: 14px 16px 16px; }
.badge { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px;
         background: var(--card-2); color: var(--dim); border: 1px solid var(--line); }
.badge.urgente { background: #3a1f22; color: #ffb3b3; border-color: #5a2f33; }
.badge.bien { background: #1e2f24; color: #a8e0ba; border-color: #2e4a37; }

/* ------------------------------------------------------------------- stat tiles */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.tile { background: var(--card-2); border: 1px solid var(--line-soft); border-radius: var(--r);
        padding: 10px 12px; }
.tile .k { color: var(--faint); font-size: 11px; text-transform: uppercase;
           letter-spacing: .06em; display: block; margin-bottom: 4px; }
.tile .v { font-size: 22px; font-weight: 600; letter-spacing: -.02em; }
.tile .d { font-size: 12px; margin-left: 6px; font-variant-numeric: tabular-nums; }
.tile .vs { color: var(--faint); font-size: 11px; margin-top: 2px; }
/* The hero: exactly one per view. Proportional figures, not tabular — at this size
   tabular digits make a three-digit number look loose. */
.hero { font-size: 46px; font-weight: 650; letter-spacing: -.03em; line-height: 1.05; }
.hero-fila { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }

/* ------------------------------------------------------------- tira de forma W/L
   Colour is NOT the encoding here: every block carries its letter. Green and yellow sit
   4.7 apart under protanopia in this palette, so a status colour never travels alone. */
.forma { display: flex; gap: 3px; flex-wrap: wrap; margin: 4px 0 2px; }
.forma .g { width: 22px; height: 26px; border-radius: 5px; display: grid; place-items: center;
            font-size: 11px; font-weight: 700; border: 1px solid; cursor: pointer;
            background: transparent; padding: 0; font-family: inherit; }
.forma .g.v { color: var(--ok); border-color: #2f5f3d; background: #17281d; }
.forma .g.d { color: var(--bad); border-color: #5f3030; background: #281818; }
.forma .g:hover { outline: 1px solid var(--accent); }
.racha { font-size: 13px; }

/* ------------------------------------------------------------------- lista/tabla */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--faint); font-weight: 600; padding: 4px 8px 6px 0;
     font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
td { padding: 5px 8px 5px 0; border-top: 1px solid var(--line-soft); }
/* The first column takes the slack. Without this a six-column table of short values spreads
   every number to the far edge of the card and the row stops reading as one thing. */
th:not(:first-child), td:not(:first-child) { width: 1%; white-space: nowrap; }
/* For a table whose first column is a short label rather than a sentence: full width would
   push the numbers to the far edge of the card and the row would stop reading as one thing. */
/* max-content, not auto: an auto-width table inside a block still stretched to the full card,
   and the numbers ended up against the far edge with a lake of nothing before them. The first
   cell also needs its own max-content, or the flex box inside it keeps stretching. */
table.compacta { width: max-content; max-width: 100%; }
table.compacta td:first-child, table.compacta th:first-child { width: max-content; }
table.compacta th:first-child, table.compacta td:first-child { padding-right: 28px; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
.row .k { color: var(--dim); }
.hint { color: var(--faint); font-size: 12px; margin: 0 0 10px; }
.alcance { color: var(--faint); font-size: 12px; margin-top: 10px; }
.vacio { color: var(--faint); font-size: 13px; padding: 6px 0; }

/* --------------------------------------------------------------------- partidas */
.plista { display: flex; flex-direction: column; gap: 6px; }
details.pfila { border: 1px solid var(--line-soft); border-radius: var(--r-sm);
                background: var(--card-2); }
details.pfila > summary { list-style: none; cursor: pointer; padding: 8px 10px;
                          display: flex; align-items: center; gap: 10px; }
details.pfila > summary::-webkit-details-marker { display: none; }
details.pfila > summary:hover { background: #232833; }
details.pfila[open] > summary { border-bottom: 1px solid var(--line-soft); }
.pfila .quien { flex: 1; min-width: 0; }
.pfila .cuando { color: var(--faint); font-size: 12px; white-space: nowrap; }
.pdetalle { padding: 12px 12px 14px; display: grid; gap: 12px; }
.bloque { border-top: 1px solid var(--line-soft); padding-top: 10px; }
.bloque:first-child { border-top: 0; padding-top: 0; }
.bloque .t { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
             color: var(--faint); margin-bottom: 6px; }
.curva-tabla { display: flex; gap: 14px; flex-wrap: wrap; font-variant-numeric: tabular-nums;
               font-size: 13px; }
.curva-tabla .p { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.curva-tabla .p .m { color: var(--faint); font-size: 11px; }

/* ----------------------------------------------------------------------- varios */
.derrota { color: var(--bad); }
.victoria { color: var(--ok); }
.pill { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; font-weight: 600;
        border-radius: 999px; padding: 2px 9px; border: 1px solid currentColor; }
code, kbd { background: #0b0d11; padding: 1px 6px; border-radius: 4px; font-size: 12px;
            border: 1px solid var(--line); font-family: ui-monospace, SFMono-Regular, monospace; }
kbd { color: var(--dim); }
button {
  font: inherit; color: var(--ink); background: #212736;
  border: 1px solid var(--line); border-radius: 7px;
  padding: 6px 12px; cursor: pointer;
}
button:hover { background: #2a3242; }
button:disabled { opacity: .4; cursor: default; }
button.on { background: #2f4d38; border-color: var(--ok); }
button.principal { background: #2a3a5c; border-color: #3d5384; color: #d6e4ff; }
button.principal:hover { background: #33456b; }
button.chico { padding: 3px 9px; font-size: 12px; }
input { font: inherit; color: var(--ink); background: #0b0d11; border: 1px solid var(--line);
        border-radius: 7px; padding: 6px 10px; width: 150px; }
input:focus, select:focus, button:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 1px;
}
.barra { height: 6px; background: #0b0d11; border-radius: 3px; overflow: hidden; margin-top: 10px; }
.barra > div { height: 100%; background: var(--ok); width: 0; transition: width .2s; }
.log { color: var(--dim); font-size: 13px; margin-top: 8px; white-space: pre-wrap; }
.face { width: 34px; height: 34px; border-radius: 8px; flex: none; background: #0b0d11;
        border: 1px solid var(--line); object-fit: cover; }
.face.chico { width: 24px; height: 24px; border-radius: 6px; }
.face.gano { border-color: #2f5f3d; }
.face.perdio { border-color: #5f3030; }
.duelo { display: flex; align-items: center; gap: 8px; }
.duelo .vs { color: var(--faint); font-size: 12px; }
.cabeza { display: flex; align-items: center; gap: 10px; }
.cabeza .nombres { font-weight: 600; }
.momento { font-variant-numeric: tabular-nums; padding: 3px 0; font-size: 13px; }
.momento .min { color: var(--warn); }
.build { display: grid; grid-template-columns: 3.6em 1fr; gap: 6px 10px; margin: 6px 0 2px;
         align-items: center; font-variant-numeric: tabular-nums; font-size: 12px; }
.build .k { color: var(--faint); font-size: 12px; }
.items { display: flex; gap: 8px; flex-wrap: wrap; }
.item { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 44px; }
.item img { width: 40px; height: 40px; border-radius: 7px; border: 1px solid var(--line);
            background: #0b0d11; }
.item .min { color: var(--faint); font-size: 11px; }
.item.tarde img { border-color: var(--warn); }
/* Keystones and classes. The icon is round because Riot draws them round; a square crop of a
   circular badge reads as a rendering bug. */
.runa { display: flex; align-items: center; gap: 8px; }
.runa img { width: 28px; height: 28px; border-radius: 50%; background: #0b0d11; flex: none; }
.runa.chica img { width: 20px; height: 20px; }
.duelo-runas { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; }
.clase { font-size: 11px; color: var(--dim); border: 1px solid var(--line); border-radius: 999px;
         padding: 1px 8px; }
/* A bar inside a table cell: the row already carries the number, so the bar is only there to
   make the column scannable. Same hue for every row — this is magnitude, not identity. */
.barrita { display: inline-block; height: 8px; border-radius: 2px; background: #3d5384;
           vertical-align: middle; min-width: 2px; }
.tag { font-size: 11px; color: var(--dim); border: 1px solid var(--line);
       border-radius: 5px; padding: 1px 6px; }
.tags { display: flex; gap: 6px; }
.partida { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.partida .quien { flex: 1; min-width: 180px; }
.partida .cuando { color: var(--faint); font-size: 12px; }
.svgbox { overflow-x: auto; }
.filtros { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }

/* ------------------------------------------------------------------- tooltip
   A chart in a browser IS interactive, and the native <svg><title> is not that: it waits most
   of a second and it cannot be styled. This one follows the pointer and shows every dimension
   the point carries, not just the one the line is drawn from. */
.tip { position: fixed; z-index: 90; pointer-events: none;
       background: var(--card-2); border: 1px solid var(--line); border-radius: var(--r-sm);
       padding: 7px 10px; font-size: 12px; font-variant-numeric: tabular-nums;
       box-shadow: 0 6px 20px rgba(0,0,0,.5); white-space: nowrap; }
.tip .m { color: var(--faint); }

/* ------------------------------------------------------------------------ avisos
   A stack of toasts instead of one shared error line: five sections failing used to write
   over each other, so the last message won and the other four vanished. */
.avisos { position: fixed; right: 16px; bottom: 16px; z-index: 100;
          display: flex; flex-direction: column; gap: 8px; max-width: 380px; }
.aviso { background: var(--card-2); border: 1px solid var(--line); border-left-width: 3px;
         border-radius: var(--r-sm); padding: 9px 12px; font-size: 13px;
         box-shadow: 0 8px 24px rgba(0,0,0,.45); animation: entra .18s ease-out; }
.aviso.mal { border-left-color: var(--bad); }
.aviso.bien { border-left-color: var(--ok); }
.aviso.info { border-left-color: var(--accent); }
.aviso .x { float: right; color: var(--faint); cursor: pointer; margin-left: 10px; }
@keyframes entra { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .aviso { animation: none; }
  details.seccion > summary .flecha { transition: none; } }

/* ------------------------------------------------------------------------ ayuda */
.teclas { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 13px; }
.teclas kbd { justify-self: start; }
/* The SVG builders carry no presentation of their own - they emit classes. Pulled in from
   render.ts rather than restated, so the static page and this one cannot drift apart, and an
   SVG here cannot silently render as black-on-black the way it did before (G-023). */
${SVG_VARS_DARK}
${SVG_STYLE}
`;

/**
 * The client script, exported ONLY so a test can parse it.
 *
 * It lives inside a template literal, which means a syntax error in it is invisible to tsc, to
 * Biome and to Vitest: the page would load, do nothing, and every check would stay green
 * (G-022). It also carries NO raw backtick — one inside a comment ended this literal three
 * hundred lines early and what spilled out happened to be invalid TypeScript, which is luck and
 * not a check, so the byte is banned and a test asserts it (G-034).
 */
export const CLIENT_SCRIPT = `
const TOKEN = new URLSearchParams(location.search).get('t');

/* ------------------------------------------------------------------- el alcance
   Which account, role and queue everything on the page is about. It used to be the string
   'smurf' written into this file, which made the second account unreachable and every game
   outside mid soloq invisible. It lives in the URL so a reload keeps it and so a particular
   view can be shared by copying the address bar. */
const ALCANCE = {
  cuenta: new URLSearchParams(location.search).get('cuenta') || null,
  rol: new URLSearchParams(location.search).get('rol') || null,
  cola: new URLSearchParams(location.search).get('cola') || null,
};

function qs(extra) {
  const p = new URLSearchParams();
  p.set('t', TOKEN);
  if (ALCANCE.cuenta) p.set('cuenta', ALCANCE.cuenta);
  if (ALCANCE.rol) p.set('rol', ALCANCE.rol);
  if (ALCANCE.cola) p.set('cola', ALCANCE.cola);
  for (const k in extra || {}) {
    if (extra[k] !== null && extra[k] !== undefined && extra[k] !== '') p.set(k, extra[k]);
  }
  return p.toString();
}

/* Writes the scope into the address bar without reloading, so a refresh lands where he was. */
function guardarAlcance() {
  const p = new URLSearchParams();
  p.set('t', TOKEN);
  if (ALCANCE.cuenta) p.set('cuenta', ALCANCE.cuenta);
  if (ALCANCE.rol) p.set('rol', ALCANCE.rol);
  if (ALCANCE.cola) p.set('cola', ALCANCE.cola);
  history.replaceState(null, '', location.pathname + '?' + p.toString());
}

const api = (path, extra) =>
  fetch(path + '?' + qs(extra)).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    return body;
  });

const post = (path, body) =>
  fetch(path + '?' + qs(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => {
    const parsed = await r.json();
    if (!r.ok) throw new Error(parsed.error || r.statusText);
    return parsed;
  });

/* --------------------------------------------------------------------- elementos */
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

/* A champion portrait, or nothing if the art is missing: the name is always in the text
   beside it, so a 404 has to degrade to plain text rather than to a broken-image icon. */
const cara = (campeon, cls) => {
  if (!campeon) return null;
  const img = document.createElement('img');
  img.className = 'face' + (cls ? ' ' + cls : '');
  img.src = '/img/champion/' + encodeURIComponent(campeon) + '.png';
  img.alt = campeon;
  img.loading = 'lazy';
  img.onerror = () => img.remove();
  return img;
};

/* ----------------------------------------------------------------------- avisos
   A stack, not a line. There used to be ONE #error element and five sections writing into
   it, so whichever failed last was the only failure anyone saw. */
function aviso(texto, clase) {
  const box = document.getElementById('avisos');
  const node = el('div', 'aviso ' + (clase || 'info'));
  const x = el('span', 'x', '×');
  x.onclick = () => node.remove();
  node.append(x, document.createTextNode(texto));
  box.append(node);
  if (clase !== 'mal') setTimeout(() => node.remove(), 4500);
  return node;
}
const fallar = (err) => aviso(err && err.message ? err.message : String(err), 'mal');

/* ------------------------------------------------------------------- colapsables
   Every section is a <details> that renders the FIRST time it is opened and remembers
   whether it was open. Two reasons, and the second is the one that matters: the page used
   to fire five fetches at load and paint everything at once, which is both slower than it
   needs to be and more than anyone can read in one look. */
const ABIERTAS = 'lol.abiertas';

function leerAbiertas() {
  try { return new Set(JSON.parse(localStorage.getItem(ABIERTAS) || '[]')); }
  catch (e) { return new Set(); }
}

function recordarAbierta(id, abierta) {
  const set = leerAbiertas();
  if (abierta) set.add(id); else set.delete(id);
  try { localStorage.setItem(ABIERTAS, JSON.stringify([...set])); } catch (e) { /* modo privado */ }
}

const SECCIONES = [];

/**
 * Builds one collapsible section.
 *
 * The resumir callback runs on every refresh and fills the badge, so a CLOSED section still says how
 * much is inside it. That is the whole contract of collapsing something: hidden must not
 * mean unknown.
 */
function seccion(id, titulo, render, opciones) {
  const o = opciones || {};
  const det = el('details', 'seccion');
  det.id = 'sec-' + id;
  const sum = el('summary');
  const flecha = el('span', 'flecha', '▶');
  const nombre = el('span', 'titulo', titulo);
  const badge = el('span', 'badge');
  badge.hidden = true;
  const resumen = el('span', 'resumen');
  sum.append(flecha, nombre, badge, resumen);
  const cuerpo = el('div', 'cuerpo');
  det.append(sum, cuerpo);

  let pintada = false;
  const pintar = async () => {
    if (pintada) return;
    pintada = true;
    cuerpo.replaceChildren(el('div', 'vacio', 'cargando…'));
    try {
      cuerpo.replaceChildren();
      await render(cuerpo);
    } catch (err) {
      pintada = false;
      cuerpo.replaceChildren(el('div', 'vacio bad', 'No se pudo cargar: ' + err.message));
      fallar(err);
    }
  };

  det.ontoggle = () => {
    recordarAbierta(id, det.open);
    if (det.open) void pintar();
  };

  const entrada = {
    id: id,
    det: det,
    cuerpo: cuerpo,
    badge: badge,
    resumen: resumen,
    resumir: o.resumir || null,
    redibujar: () => { pintada = false; if (det.open) void pintar(); },
    abrir: () => { det.open = true; },
  };
  SECCIONES.push(entrada);
  return entrada;
}

/** Re-runs every section's summary, and repaints the ones that are open. */
async function refrescarSecciones(estado) {
  for (const s of SECCIONES) {
    if (s.resumir) {
      try {
        const r = s.resumir(estado);
        if (r) {
          s.badge.hidden = !r.badge;
          if (r.badge) {
            s.badge.textContent = r.badge;
            s.badge.className = 'badge' + (r.tono ? ' ' + r.tono : '');
          }
          s.resumen.textContent = r.texto || '';
        }
      } catch (e) { /* a summary must never break the page */ }
    }
  }
}

/* -------------------------------------------------------------- la barra superior */
function renderScope(f) {
  const box = document.getElementById('scope');
  box.replaceChildren();

  for (const c of f.cuentas) {
    const chip = el('button', 'chip', c.label);
    chip.setAttribute('aria-pressed', String(c.valor === ALCANCE.cuenta));
    chip.onclick = () => {
      if (c.valor === ALCANCE.cuenta) return;
      ALCANCE.cuenta = c.valor;
      // The role and queue belong to the account that was showing: he plays mid on one and
      // whatever on the other, and carrying a filter across would show an empty page with no
      // hint that the filter, not the cache, is what emptied it.
      ALCANCE.rol = null;
      ALCANCE.cola = null;
      guardarAlcance();
      void arrancar();
    };
    box.append(chip);
  }

  if (f.cuentas.length > 0) box.append(el('span', 'sep', '·'));

  const selRol = el('select');
  selRol.title = 'rol';
  const todosR = el('option', null, 'todos los roles');
  todosR.value = '';
  selRol.append(todosR);
  for (const r of f.roles) {
    const o = el('option', null, r.label + ' (' + r.partidas + ')');
    o.value = r.valor;
    selRol.append(o);
  }
  selRol.value = ALCANCE.rol || '';
  selRol.onchange = () => { ALCANCE.rol = selRol.value || null; guardarAlcance(); void arrancar(); };

  const selCola = el('select');
  selCola.title = 'cola';
  const todasC = el('option', null, 'todas las colas');
  todasC.value = '';
  selCola.append(todasC);
  for (const c of f.colas) {
    const o = el('option', null, c.label + ' (' + c.partidas + ')');
    o.value = String(c.valor);
    selCola.append(o);
  }
  selCola.value = ALCANCE.cola || '';
  selCola.onchange = () => { ALCANCE.cola = selCola.value || null; guardarAlcance(); void arrancar(); };

  box.append(selRol, selCola);
}

/* ------------------------------------------------------------------ qué hacer ahora
   ONE card, the most urgent thing, with the button that does it. The rest of the list goes
   underneath in one line each: five equally-sized cards is a to-do list, and a to-do list
   with five entries is not an answer to "qué hago ahora". */
function renderAhora(acciones) {
  const box = document.getElementById('ahora');
  box.replaceChildren();

  if (acciones.length === 0) {
    const card = el('div', 'destacada');
    card.append(el('span', 'marca urg-cuando_puedas', 'al día'));
    const txt = el('div', 'txt');
    txt.append(el('div', 'que', 'Nada que hacer'));
    txt.append(el('div', 'porque',
      'Todo tagueado y sincronizado. Lo de abajo es para mirar, no para ejecutar.'));
    card.append(txt);
    box.append(card);
    return;
  }

  const [primera, ...resto] = acciones;
  const card = el('div', 'destacada');
  card.append(el('span', 'marca urg-' + primera.urgencia,
    primera.urgencia === 'ahora' ? 'ahora' : 'cuando puedas'));
  const txt = el('div', 'txt');
  txt.append(el('div', 'que', primera.que));
  txt.append(el('div', 'porque', primera.porque));

  const acts = el('div', 'acciones');
  const botones = {
    taguear: ['Ir a taguear', () => abrirSeccion('taguear')],
    sync: ['Sincronizar ahora', () => { abrirSeccion('sync'); lanzarSync(); }],
    backfill: ['Sincronizar (repara timelines)', () => { abrirSeccion('sync'); lanzarSync(); }],
    key: ['Ver la key', () => abrirSeccion('cuentas')],
    resolver_cuenta: ['Registrar cuenta', () => { document.getElementById('primera-vez').hidden = false; }],
  };
  const b = botones[primera.id];
  if (b) {
    const boton = el('button', 'principal', b[0]);
    boton.onclick = b[1];
    acts.append(boton);
  }
  txt.append(acts);
  card.append(txt);
  box.append(card);

  if (resto.length > 0) {
    const otras = el('div', 'otras');
    for (const a of resto) {
      const fila = el('div', 'otra');
      fila.append(el('span', 'punto urg-' + a.urgencia));
      fila.append(el('span', null, a.que));
      otras.append(fila);
    }
    box.append(otras);
  }
}

function abrirSeccion(id) {
  const s = SECCIONES.find((x) => x.id === id);
  if (!s) return;
  s.abrir();
  s.det.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* --------------------------------------------------------------------- el resumen
   The one card that is open by default besides "ahora". Four numbers and a strip: enough
   to know how it is going, not enough to have to read. */
function fecha(ms) {
  return new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}
function fechaHora(ms) {
  return new Date(ms).toLocaleString('es-AR', { hourCycle: 'h23', day: '2-digit',
    month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function reloj(segundos) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return m + ':' + String(s).padStart(2, '0');
}

async function renderResumen(box) {
  const r = await api('/api/resumen');

  if (r.jugadas === 0) {
    box.append(el('div', 'vacio',
      'No hay partidas con ese filtro. Probá con otro rol o cola, o sincronizá.'));
    return;
  }

  /* The hero: the actual result, with its n beside it. It is not a proxy for anything, so
     nothing about G-008 applies — but a rate without its denominator is a lie by omission. */
  const fila = el('div', 'hero-fila');
  const wr = el('div', 'hero nums', Math.round(r.winRate * 100) + '%');
  fila.append(wr);
  fila.append(el('div', 'dim', r.ganadas + 'V–' + (r.jugadas - r.ganadas) + 'D  ·  ' +
    r.jugadas + ' partidas  ·  ' + r.alcance.rol + ', ' + r.alcance.cola));
  box.append(fila);

  /* The form strip. Every block carries its letter: colour never travels alone here. */
  if (r.forma.length > 0) {
    const tira = el('div', 'forma');
    for (const g of r.forma) {
      const b = el('button', 'g ' + (g.gano ? 'v' : 'd'), g.gano ? 'V' : 'D');
      b.title = (g.gano ? 'Victoria' : 'Derrota') + ' · ' + g.campeon +
        (g.rival ? ' vs ' + g.rival : '') + ' · ' + fechaHora(g.at) +
        (g.tag ? ' · tag: ' + g.tag : '');
      b.onclick = () => abrirPartida(g.matchId);
      tira.append(b);
    }
    box.append(tira);
    const pie = el('div', 'racha faint');
    pie.textContent = 'últimas ' + r.forma.length + ', la más nueva a la derecha' +
      (r.racha ? '  ·  racha: ' + r.racha.largo + ' ' +
        (r.racha.tipo === 'V' ? 'victoria' : 'derrota') + (r.racha.largo === 1 ? '' : 's') +
        ' seguida' + (r.racha.largo === 1 ? '' : 's') : '');
    box.append(pie);
  }

  if (r.hoy.jugadas > 0) {
    const hoy = el('div', 'card plano');
    hoy.style.marginTop = '12px';
    hoy.append(el('div', 't', 'hoy'));
    hoy.append(el('div', null, r.hoy.jugadas + ' partida' + (r.hoy.jugadas === 1 ? '' : 's') +
      ' · ' + r.hoy.ganadas + 'V–' + (r.hoy.jugadas - r.hoy.ganadas) + 'D' +
      (r.hoy.sinTaguear > 0 ? ' · ' + r.hoy.sinTaguear + ' sin taguear' : ' · todas tagueadas')));
    box.append(hoy);
  }

  if (r.tiles.length > 0) {
    box.append(el('h3', null, 'contra tu rival de línea'));
    const tiles = el('div', 'tiles');
    for (const t of r.tiles) {
      const tile = el('div', 'tile');
      tile.title = t.nota;
      tile.append(el('span', 'k', t.label));
      const v = el('div');
      v.append(el('span', 'v nums', t.valor.toFixed(t.decimales)));
      if (t.delta !== null) {
        const bueno = t.masEsMejor ? t.delta > 0 : t.delta < 0;
        const cero = t.delta === 0;
        const d = el('span', 'd ' + (cero ? 'faint' : bueno ? 'ok' : 'bad'));
        /* An arrow beside the sign, so the good/bad reading is never colour alone. */
        d.textContent = (cero ? '=' : bueno ? '▲' : '▼') + ' ' +
          (t.delta > 0 ? '+' : '') + t.delta.toFixed(t.decimales);
        v.append(d);
      }
      tile.append(v);
      tile.append(el('div', 'vs', t.rival === null ? 'sin rival medido'
        : 'rival ' + t.rival.toFixed(t.decimales)));
      tiles.append(tile);
    }
    box.append(tiles);
    box.append(el('div', 'alcance',
      'Sólo métricas medibles ANTES de que el resultado esté decidido. Las que suben porque ' +
      'vas ganando (KDA, CS/min, daño, visión) no tienen tarjeta acá a propósito.'));
  }

  if (r.porCampeon.length > 1) {
    // Folded one level deeper on purpose: it is a table, and a table is the thing that turns a
    // card you glance at into a page you have to read.
    const det = el('details');
    const sum = el('summary', 'hint');
    sum.style.cursor = 'pointer';
    sum.textContent = 'ver por campeón (' + r.porCampeon.length + ')';
    det.append(sum);
    const tabla = document.createElement('table');
    tabla.className = 'compacta';
    const head = document.createElement('tr');
    for (const h of ['campeón', 'partidas', 'ganadas', 'cs@10', 'rival', 'dif']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.append(th);
    }
    tabla.append(head);
    for (const c of r.porCampeon) {
      const tr = document.createElement('tr');
      const dif = c.csDiez === null || c.csDiezRival === null ? null : c.csDiez - c.csDiezRival;
      const celdas = [
        c.campeon,
        String(c.jugadas),
        c.ganadas + '/' + c.jugadas,
        c.csDiez === null ? '—' : c.csDiez.toFixed(1),
        c.csDiezRival === null ? '—' : c.csDiezRival.toFixed(1),
        dif === null ? '—' : (dif > 0 ? '+' : '') + dif.toFixed(1),
      ];
      celdas.forEach((valor, i) => {
        const td = document.createElement('td');
        td.textContent = valor;
        if (i >= 1) td.className = 'nums';
        if (i === 5 && dif !== null && dif !== 0) td.classList.add(dif > 0 ? 'ok' : 'bad');
        tr.append(td);
      });
      tabla.append(tr);
    }
    det.append(tabla);
    // The denominator is the whole point of the table: a 3/4 on one champion is not a finding.
    det.append(el('div', 'alcance',
      'Un récord de cinco partidas es una moneda con nombre. La columna de partidas está para ' +
      'que eso se lea solo, y nada de acá está rankeado como fuerte o flojo.'));
    box.append(det);
  }
}

/* -------------------------------------------------------------------- las partidas
   A browsable list with filters, which the panel simply did not have: everything it showed
   was a top-N of something, so "cómo me fue con Diana contra Zed" had no way to be asked.
   Each row expands into the full derivation, fetched only when it is opened — nine analyses
   over a raw timeline is 20-40 ms that nobody should pay for forty rows they are not
   reading. */
const FILTRO = { campeon: '', rival: '', resultado: '', tag: '', limite: 25 };
let CAMPEONES = [];

function abrirPartida(matchId) {
  const s = SECCIONES.find((x) => x.id === 'partidas');
  if (!s) return;
  s.abrir();
  s.det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Wait for the section to have painted its list before reaching into it.
  setTimeout(() => {
    const fila = document.getElementById('p-' + matchId);
    if (fila) { fila.open = true; fila.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }, 250);
}

async function renderPartidas(box) {
  const filtros = el('div', 'filtros');

  const selCampeon = el('select');
  selCampeon.title = 'tu campeón';
  const todosCampeones = el('option', null, 'todos tus campeones');
  todosCampeones.value = '';
  selCampeon.append(todosCampeones);
  for (const c of CAMPEONES) {
    const o = el('option', null, c.valor + ' (' + c.partidas + ')');
    o.value = c.valor;
    selCampeon.append(o);
  }
  selCampeon.value = FILTRO.campeon;

  const selResultado = el('select');
  for (const [valor, label] of [['', 'ganadas y perdidas'], ['ganadas', 'sólo ganadas'],
                                ['perdidas', 'sólo perdidas']]) {
    const o = el('option', null, label);
    o.value = valor;
    selResultado.append(o);
  }
  selResultado.value = FILTRO.resultado;

  const selTag = el('select');
  for (const [valor, label] of [['', 'con y sin tag'], ['sin', 'sin taguear'],
                                ['mía', 'tag: la produje yo'], ['igual', 'tag: salía igual'],
                                ['pareja', 'tag: estuvo pareja']]) {
    const o = el('option', null, label);
    o.value = valor;
    selTag.append(o);
  }
  selTag.value = FILTRO.tag;

  const inRival = el('input');
  inRival.placeholder = 'rival (ej. Zed)';
  inRival.value = FILTRO.rival;
  inRival.size = 12;

  const lista = el('div', 'plista');

  const recargar = async () => {
    FILTRO.campeon = selCampeon.value;
    FILTRO.resultado = selResultado.value;
    FILTRO.tag = selTag.value;
    FILTRO.rival = inRival.value.trim();
    lista.replaceChildren(el('div', 'vacio', 'buscando…'));
    try {
      const filas = await api('/api/partidas', {
        campeon: FILTRO.campeon, resultado: FILTRO.resultado,
        tag: FILTRO.tag, rival: FILTRO.rival, limite: FILTRO.limite,
      });
      pintarFilas(lista, filas);
    } catch (err) {
      lista.replaceChildren(el('div', 'vacio', 'No se pudo buscar: ' + err.message));
    }
  };

  selCampeon.onchange = recargar;
  selResultado.onchange = recargar;
  selTag.onchange = recargar;
  inRival.onchange = recargar;
  inRival.onkeydown = (e) => { if (e.key === 'Enter') void recargar(); };

  const limpiar = el('button', 'chico', 'limpiar');
  limpiar.onclick = () => {
    selCampeon.value = ''; selResultado.value = ''; selTag.value = ''; inRival.value = '';
    void recargar();
  };

  const mas = el('button', 'chico', 'ver más');
  mas.onclick = () => { FILTRO.limite = Math.min(FILTRO.limite + 25, 200); void recargar(); };

  filtros.append(selCampeon, selResultado, selTag, inRival, limpiar, mas);
  box.append(filtros, lista);
  await recargar();
}

function pintarFilas(lista, filas) {
  lista.replaceChildren();
  if (filas.length === 0) {
    lista.append(el('div', 'vacio', 'Ninguna partida con esos filtros.'));
    return;
  }
  for (const p of filas) lista.append(filaPartida(p));
  lista.append(el('div', 'alcance', filas.length + ' partida' + (filas.length === 1 ? '' : 's') +
    ' — el detalle de cada una se calcula al abrirla.'));
}

function filaPartida(p) {
  const det = el('details', 'pfila');
  det.id = 'p-' + p.matchId;
  const sum = el('summary');

  const duelo = el('div', 'duelo');
  const c1 = cara(p.campeon, 'chico ' + (p.gano ? 'gano' : 'perdio'));
  if (c1) duelo.append(c1);
  if (p.rival) {
    duelo.append(el('span', 'vs', 'vs'));
    const c2 = cara(p.rival, 'chico');
    if (c2) duelo.append(c2);
  }

  const quien = el('div', 'quien');
  quien.append(el('span', p.gano ? 'victoria' : 'derrota', p.gano ? 'V' : 'D'));
  quien.append(document.createTextNode('  ' + p.campeon + (p.rival ? ' vs ' + p.rival : '')));
  const meta = el('div', 'cuando');
  meta.textContent = p.kda + ' · ' + reloj(p.duracion) + ' · ' + p.rol + ' · ' + p.cola +
    (p.sinTimeline ? ' · SIN TIMELINE' : '');
  quien.append(meta);

  sum.append(el('span', 'flecha', '▶'), duelo, quien);
  if (p.tag) sum.append(el('span', 'tag', p.tag));
  sum.append(el('span', 'cuando', fecha(p.at)));
  det.append(sum);

  const cuerpo = el('div', 'pdetalle');
  cuerpo.append(el('div', 'vacio', 'abrí para calcular el detalle'));
  det.append(cuerpo);

  let pedido = false;
  det.ontoggle = async () => {
    if (!det.open || pedido) return;
    pedido = true;
    cuerpo.replaceChildren(el('div', 'vacio', 'calculando…'));
    try {
      const d = await api('/api/partida', { id: p.matchId });
      cuerpo.replaceChildren();
      pintarDetalle(cuerpo, d);
    } catch (err) {
      pedido = false;
      cuerpo.replaceChildren(el('div', 'vacio', 'No se pudo: ' + err.message));
    }
  };
  return det;
}

/* A keystone, or nothing. The name is always in the text beside it, so a missing icon degrades
   to plain text rather than to a broken-image box — same contract as the champion portraits. */
const runaIcono = (k, chica) => {
  const caja = el('div', 'runa' + (chica ? ' chica' : ''));
  const img = document.createElement('img');
  img.src = '/img/rune/' + k.runeId + '.png';
  img.alt = k.name;
  img.loading = 'lazy';
  img.onerror = () => img.remove();
  caja.append(img, el('span', null, k.name));
  return caja;
};

function bloque(padre, titulo) {
  const b = el('div', 'bloque');
  b.append(el('div', 't', titulo));
  padre.append(b);
  return b;
}

function pintarDetalle(box, d) {
  // Runes and classes come from the match payload itself, so they show even for a game with no
  // timeline — which is why this block sits above the early return.
  if ((d.runas && (d.runas.mia || d.runas.suya)) || d.clasesRival.length > 0) {
    const b = bloque(box, 'runas y clase del rival');
    if (d.runas && (d.runas.mia || d.runas.suya)) {
      const fila = el('div', 'duelo-runas');
      if (d.runas.mia) {
        const m = el('div', 'runa');
        m.append(el('span', 'faint', 'vos'), runaIcono(d.runas.mia, false));
        fila.append(m);
      }
      if (d.runas.suya) {
        const t = el('div', 'runa');
        t.append(el('span', 'faint', 'rival'), runaIcono(d.runas.suya, false));
        fila.append(t);
      }
      b.append(fila);
    }
    if (d.clasesRival.length > 0) {
      const clases = el('div');
      clases.style.marginTop = '6px';
      for (const c of d.clasesRival) clases.append(el('span', 'clase', c));
      b.append(clases);
    }
  }

  if (d.derivado === null) {
    const b = bloque(box, 'sin timeline');
    b.append(el('div', 'dim',
      'Esta partida está en la caché pero sin datos por minuto, así que no hay curva, ni ' +
      'momentos, ni ítems, ni muertes. Sincronizá: la segunda fase repara timelines viejos.'));
    return;
  }
  const v = d.derivado;

  if (v.curva.length > 0) {
    const b = bloque(box, 'oro contra tu rival de línea');
    const tabla = el('div', 'curva-tabla');
    for (const p of v.curva) {
      const col = el('div', 'p');
      col.append(el('span', p.oro >= 0 ? 'ok' : 'bad',
        (p.oro >= 0 ? '+' : '') + p.oro));
      col.append(el('span', 'm', p.minuto + '′'));
      tabla.append(col);
    }
    b.append(tabla);
    if (v.swing) {
      b.append(el('div', 'dim', 'mayor movimiento: ' + (v.swing.delta >= 0 ? '+' : '') +
        v.swing.delta + ' de oro entre ' + v.swing.desde + '′ y ' + v.swing.hasta + '′'));
    }
  }

  if (v.fases.length > 0) {
    const b = bloque(box, 'por fase — cs·min tuyo / del rival');
    b.append(el('div', 'nums', v.fases.map((f) =>
      f.nombre + ' ' + f.csPorMin.toFixed(1) + '/' +
      (f.rivalCsPorMin === null ? '?' : f.rivalCsPorMin.toFixed(1)) +
      ' (' + f.muertes + '†)').join('   ·   ')));
  }

  const b2 = bloque(box, 'peleas y muertes');
  b2.append(el('div', null, v.muertes.total + ' muertes (' + v.muertes.solo + ' solo) · ' +
    // "presente en 0/0 peleas" is a fraction with nothing in it — say there were none.
    (v.peleas.total === 0
      ? 'ninguna pelea de 3+ kills'
      : 'presente en ' + v.peleas.presente + '/' + v.peleas.total + ' peleas · moriste primero en ' +
        v.peleas.primeroEnMorir) +
    ' · ' + v.peleas.picks + ' picks sueltos'));
  b2.append(el('div', 'dim', 'épicos: ' + v.epicos.conCredito + '/' + v.epicos.delEquipo +
    ' con crédito tuyo · ' + v.epicos.sinWard + ' sin ward tuya 60s antes · ' +
    v.epicos.muertoAntes + ' con vos muerto 30s antes'));

  if (v.tempo || v.roams) {
    const b = bloque(box, 'tempo y posición');
    const partes = [];
    if (v.tempo) {
      partes.push('1ª vuelta ' + (v.tempo.tuya === null ? '—' : v.tempo.tuya + '′') +
        ' vs ' + (v.tempo.suya === null ? '—' : v.tempo.suya + '′'));
    }
    if (v.roams) {
      partes.push(Math.round(v.roams.mid * 100) + '% en mid');
      partes.push(Math.round(v.roams.mitadEnemiga * 100) + '% en mitad enemiga');
    }
    b.append(el('div', null, partes.join(' · ')));
  }

  if (v.sinCatalogo) {
    const b = bloque(box, 'ítems');
    b.append(el('div', 'dim', 'sin catálogo para el parche ' + v.sinCatalogo +
      ' — corré lol items una vez por parche'));
  } else if (v.items) {
    const b = bloque(box, 'build — vos arriba, el rival abajo');
    b.append(construirBuild(v.items));
  }

  if (v.momentos.length > 0) {
    const b = bloque(box, 'lo que salió más caro');
    for (const m of v.momentos) {
      const linea = el('div', 'momento');
      linea.append(el('span', 'min', 'min ' + m.minuto + '  '));
      linea.append(document.createTextNode(m.linea + '  '));
      linea.append(el('span', 'dim', '[' + m.oro + ' de oro]'));
      b.append(linea);
    }
    if (v.sinMedir > 0) {
      b.append(el('div', 'faint', '(' + v.sinMedir +
        ' muertes sin ventana de 2 min por delante, no rankeadas)'));
    }
  }
}

function construirBuild(items) {
  const grid = el('div', 'build');
  const fila = (etiqueta, pasos, tarde) => {
    grid.append(el('div', 'k', etiqueta));
    const caja = el('div', 'items');
    if (pasos.length === 0) caja.append(el('span', 'faint', '—'));
    for (const paso of pasos) {
      const celda = el('div', 'item' + (tarde ? ' tarde' : ''));
      const img = document.createElement('img');
      img.src = '/img/item/' + paso.id + '.png';
      img.alt = paso.nombre;
      img.title = paso.nombre;
      img.loading = 'lazy';
      img.onerror = () => { celda.replaceChildren(el('span', null, paso.nombre)); };
      celda.append(img, el('span', 'min', paso.min));
      caja.append(celda);
    }
    grid.append(caja);
  };
  const tarde = items.primerItemMin !== null && items.primerItemMin > 0;
  fila('vos', items.mios, tarde);
  fila('rival', items.suyos, false);
  if (items.primerItemMin !== null) {
    const g = items.primerItemMin;
    grid.append(el('div', 'k', ''));
    grid.append(el('div', 'faint',
      'primer ítem ' + (g >= 0 ? '+' : '') + g.toFixed(1) + ' min' +
      (g > 0 ? ' (llegó primero él)' : g < 0 ? ' (llegaste primero)' : '') +
      ' — se compra con oro, leelo al lado de la curva'));
  }
  return grid;
}

/* --------------------------------------------------------------------- el tagueo
   The one input the software cannot derive, and the only one that cannot be recovered
   later (ADR-015). Unchanged in substance; it now lives inside a collapsible that opens
   itself whenever there is anything pending. */
const TAGS = [
  ['mía', 'La produje yo', '1'],
  ['igual', 'Salía igual', '2'],
  ['pareja', 'Estuvo pareja', '3'],
];

let sesion = null;
/** The card the keyboard shortcuts act on: the first pending game on screen. */
let tarjetaEnFoco = null;

function tarjetaPartida(p, alTaguear, primera) {
  const card = el('div', 'card partida');
  if (primera) card.style.borderColor = 'var(--accent)';
  const retrato = cara(p.campeon, p.gano ? 'gano' : 'perdio');
  if (retrato) card.append(retrato);
  const quien = el('div', 'quien');
  quien.append(el('span', null, p.campeon + '  '));
  quien.append(el('span', p.gano ? 'victoria' : 'derrota', p.gano ? 'victoria' : 'DERROTA'));
  quien.append(el('div', 'cuando', fechaHora(p.terminoAt)));
  card.append(quien);

  const tags = el('div', 'tags');
  const marcar = async (valor, boton) => {
    for (const otro of tags.children) otro.disabled = true;
    try {
      // One request per game, and the tag is on disk before this resolves.
      if (sesion === null) sesion = (await post('/api/sesion/abrir')).sesion;
      await post('/api/tag', { matchId: p.matchId, tag: valor, sesion });
      boton.classList.add('on');
      setTimeout(alTaguear, 300);
    } catch (err) {
      fallar(err);
      for (const otro of tags.children) otro.disabled = false;
    }
  };
  for (const [valor, etiqueta, tecla] of TAGS) {
    const b = el('button', null, etiqueta);
    b.title = 'tecla ' + tecla;
    b.dataset.tecla = tecla;
    b.onclick = () => marcar(valor, b);
    tags.append(b);
  }
  card.append(tags);
  if (primera) tarjetaEnFoco = tags;
  return card;
}

async function renderPendientes(box) {
  const { deLaSesion, atrasadas } = await api('/api/pendientes');
  tarjetaEnFoco = null;

  const refrescarTodo = () => {
    const s = SECCIONES.find((x) => x.id === 'taguear');
    if (s) s.redibujar();
    void refrescar();
  };

  if (deLaSesion.length === 0 && atrasadas.length === 0) {
    box.append(el('div', 'vacio ok', 'Nada sin taguear. Listo.'));
    return;
  }

  if (deLaSesion.length > 0) {
    box.append(el('p', 'hint',
      'Más viejas primero, en el orden en que las jugaste. Cada click se guarda en el momento: ' +
      'si cerrás la pestaña a la mitad, lo que ya marcaste queda. Teclas 1 · 2 · 3.'));
    deLaSesion.forEach((p, i) => box.append(tarjetaPartida(p, refrescarTodo, i === 0)));
  } else {
    box.append(el('p', 'hint', 'Nada de las últimas 12 horas.'));
  }

  // The backlog is FOLDED, not dropped. Tagging a two-week-old game is recall rather than
  // observation and the lag column will say so; hiding the pile entirely would be deciding for
  // him, showing it open would bury tonight's games under it.
  if (atrasadas.length > 0) {
    const abrir = el('button', 'chico', 'Ver ' + atrasadas.length + ' partida(s) más viejas');
    const viejas = el('div');
    abrir.onclick = () => {
      abrir.remove();
      viejas.append(el('p', 'hint',
        'Tienen más de 12 horas. Taguearlas es acordarse, no observar — queda anotado cuánto ' +
        'tardaste, así que no se mezclan con las de recién.'));
      for (const p of atrasadas) viejas.append(tarjetaPartida(p, refrescarTodo, false));
    };
    // The other honest answer to a backlog, and the one he actually gave: he does not remember
    // those games. It writes a dated decision, it does not delete anything, and the panel stops
    // demanding something that cannot be done well.
    const dejar = el('button', 'chico', 'No las voy a taguear');
    dejar.onclick = async () => {
      if (!confirm('Van a quedar ' + atrasadas.length + ' partida(s) sin taguear a propósito, ' +
        'con la fecha de hoy. Se puede deshacer, pero no se puede taguear después.')) return;
      dejar.disabled = true;
      dejar.textContent = 'anotando…';
      try {
        const r = await post('/api/dejar-atras');
        aviso(r.dejadasAtras + ' partida(s) quedan sin taguear a propósito. Las que juegues ' +
          'de ahora en más aparecen acá.', 'bien');
        refrescarTodo();
      } catch (e) {
        dejar.disabled = false;
        dejar.textContent = 'No las voy a taguear';
        fallar(e);
      }
    };
    const fila = el('div', 'tags');
    fila.append(abrir, dejar);
    box.append(fila, viejas);
  }

  box.append(el('h3', null, 'tilt de la sesión'));
  box.append(el('div', 'hint',
    'Cómo terminaste. "No contesto" no es un 3 del medio: queda sin medir, que es distinto.'));
  const row = el('div', 'tags');
  for (const n of [1, 2, 3, 4, 5]) {
    const b = el('button', 'chico', String(n));
    b.onclick = () => guardarTilt(n, row);
    row.append(b);
  }
  const skip = el('button', 'chico', 'No contesto');
  skip.onclick = () => guardarTilt(null, row);
  row.append(skip);
  box.append(row);
}

async function guardarTilt(tilt, row) {
  try {
    if (sesion === null) sesion = (await post('/api/sesion/abrir')).sesion;
    await post('/api/sesion/cerrar', { sesion, tilt });
    sesion = null;
    for (const b of row.children) b.disabled = true;
    aviso(tilt === null ? 'Sesión cerrada sin tilt.' : 'Sesión cerrada con tilt ' + tilt + '.', 'bien');
  } catch (err) { fallar(err); }
}

/* ---------------------------------------------------------------------- el sync */
let syncCorriendo = false;

function renderSync(box) {
  const card = el('div', 'card plano');
  const boton = el('button', 'principal', 'Sincronizar ahora');
  boton.id = 'boton-sync';
  const barra = el('div', 'barra');
  const relleno = el('div');
  barra.append(relleno);
  const log = el('div', 'log');
  card.append(el('div', 'hint',
    'Baja las partidas nuevas y después repara los timelines que falten de partidas viejas. ' +
    'Unas 25 partidas por minuto: el límite de Riot es 100 requests cada 2 minutos.'));
  card.append(boton, barra, log);
  box.append(card);

  boton.onclick = () => {
    if (syncCorriendo) return;
    syncCorriendo = true;
    boton.disabled = true;
    log.textContent = 'conectando…';
    relleno.style.width = '0';

    // EventSource cannot send headers, which is exactly why the token lives in the query string
    // rather than in an Authorization header.
    const src = new EventSource('/api/sync?' + qs());
    const terminar = () => { src.close(); boton.disabled = false; syncCorriendo = false; };
    src.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (e.tipo === 'inicio') log.textContent = 'sincronizando ' + e.cuenta + '…';
      if (e.tipo === 'progreso') {
        relleno.style.width = (e.total === 0 ? 0 : (e.hechas / e.total) * 100) + '%';
        // The phase is named because the bar restarts at zero for the second one, and an
        // unlabelled bar going back to zero reads as a bug rather than as a second job.
        const que = e.fase === 'timelines' ? ' timelines de partidas ya bajadas' : ' partidas';
        log.textContent = e.hechas + ' de ' + e.total + que;
      }
      if (e.tipo === 'fin') {
        relleno.style.width = '100%';
        log.textContent =
          e.bajadas + ' nueva(s), ' + e.timelines + ' timeline(s), ' + e.remakes + ' remake(s)' +
          (e.reparados ? ', ' + e.reparados + ' timeline(s) viejo(s) reparado(s)' : '') +
          // Said out loud: one click is capped, so "finished" is not "there is nothing left".
          (e.sinTimeline ? ', quedan ' + e.sinTimeline + ' sin timeline (dale de nuevo)' : '') +
          (e.errores.length ? '\\n' + e.errores.slice(0, 3).join('\\n') : '');
        aviso(e.bajadas + ' partida(s) nueva(s)' +
          (e.reparados ? ', ' + e.reparados + ' timeline(s) reparado(s)' : ''), 'bien');
        terminar();
        void arrancar();
      }
      if (e.tipo === 'error') {
        log.textContent = 'no corrió: ' + e.mensaje;
        fallar(new Error(e.mensaje));
        terminar();
      }
    };
    // Fires when the stream drops without a 'fin' — a dead key, a closed laptop. The button has
    // to come back, or the page is bricked until a reload.
    src.onerror = () => {
      if (!log.textContent || log.textContent === 'conectando…') {
        log.textContent = 'se cortó la conexión con el servidor';
      }
      terminar();
    };
  };
}

function lanzarSync() {
  const b = document.getElementById('boton-sync');
  if (b && !b.disabled) b.click();
}

/* ------------------------------------------------------------- lo que salió caro */
async function renderMomentos(box) {
  const partidas = await api('/api/momentos', { limite: 5 });
  if (partidas.length === 0) {
    box.append(el('div', 'vacio', 'No hay partidas con ese filtro.'));
    return;
  }
  for (const p of partidas) {
    const card = el('div', 'card plano');
    const cabeza = el('div', 'cabeza');
    const retrato = cara(p.campeon, p.gano ? 'gano' : 'perdio');
    if (retrato) cabeza.append(retrato);
    if (p.rival) {
      cabeza.append(el('span', 'vs', 'vs'));
      const r = cara(p.rival, 'chico');
      if (r) cabeza.append(r);
    }
    const nombres = el('div', 'nombres', p.campeon + (p.rival ? ' vs ' + p.rival : ''));
    cabeza.append(nombres);
    cabeza.append(el('span', 'pill ' + (p.gano ? 'ok' : 'bad'), p.gano ? 'ganada' : 'perdida'));
    if (p.tag) cabeza.append(el('span', 'tag', p.tag));
    const ver = el('button', 'chico', 'ver todo');
    ver.style.marginLeft = 'auto';
    ver.onclick = () => abrirPartida(p.matchId);
    cabeza.append(ver);
    card.append(cabeza);
    card.append(el('div', 'faint', fechaHora(p.at)));

    if (p.sinTimeline) {
      card.append(el('div', 'dim',
        'Sin timeline: no hay minuto que mirar. Sincronizá y se repara.'));
      box.append(card);
      continue;
    }
    if (p.items) card.append(construirBuild(p.items));
    if (p.momentos.length === 0) card.append(el('div', 'faint', 'sin momentos medibles'));
    for (const m of p.momentos) {
      const linea = el('div', 'momento');
      linea.append(el('span', 'min', 'min ' + m.minuto + '  '));
      linea.append(document.createTextNode(m.linea + '  '));
      linea.append(el('span', 'dim', '[' + m.oro + ' de oro]'));
      card.append(linea);
    }
    if (p.sinMedir > 0) {
      card.append(el('div', 'faint',
        '(' + p.sinMedir + ' muertes sin ventana de 2 min por delante, no rankeadas)'));
    }
    box.append(card);
  }
  box.append(el('div', 'alcance',
    'Los replays .rofl son locales y se rompen al cambiar de parche: esto sirve dentro de la semana.'));
}

/* ------------------------------------------------------------------ curva y mapa */
async function renderGraficos(box) {
  const g = await api('/api/graficos');
  if (g.curva) {
    const card = el('div', 'card plano');
    card.append(el('div', 't', 'oro contra tu rival de línea — última partida medible'));
    const holder = el('div', 'svgbox');
    holder.innerHTML = g.curva;
    card.append(holder);
    box.append(card);
    engancharTooltip(holder);
  }
  const card = el('div', 'card plano');
  card.append(el('div', 't', 'dónde morís'));
  card.append(el('div', 'dim',
    g.muertes + ' muertes en ' + g.partidas + ' partidas · ' +
    g.propiaMitad + ' en tu mitad, ' + (g.muertes - g.propiaMitad) + ' en la enemiga'));
  const holder = el('div', 'svgbox');
  holder.innerHTML = g.mapa;
  card.append(holder);
  box.append(card);
}

/**
 * The hover layer for the gold curve.
 *
 * Attached after the SVG lands in the document rather than built into it, because the builder is
 * shared with the static page (ADR-014) and that one has no JavaScript at all — so the markup
 * stays inert and the panel adds behaviour on top. The svg title inside each dot is the floor
 * that survives with this turned off.
 */
function engancharTooltip(caja) {
  const tip = el('div', 'tip');
  tip.hidden = true;
  document.body.append(tip);
  let vivo = null;

  const mostrar = (hit, evento) => {
    const oro = Number(hit.dataset.oro);
    const cs = Number(hit.dataset.cs);
    const xp = Number(hit.dataset.xp);
    const firma = (n, sufijo) => (n > 0 ? '+' : '') + n + (sufijo || '');
    tip.replaceChildren();
    tip.append(el('div', null, hit.dataset.minuto + ' minutos'));
    const linea = el('div');
    linea.append(el('span', oro >= 0 ? 'ok' : 'bad', firma(oro) + ' de oro'));
    linea.append(el('span', 'm', '   ' + firma(cs) + ' cs   ' + firma(xp) + ' xp'));
    tip.append(linea);
    tip.hidden = false;
    // Offset so the cursor never sits on top of the thing it is pointing at, and flipped near
    // the right edge so the tooltip does not push the page sideways.
    const ancho = tip.offsetWidth;
    const x = evento.clientX + 14 + ancho > window.innerWidth
      ? evento.clientX - 14 - ancho : evento.clientX + 14;
    tip.style.left = x + 'px';
    tip.style.top = (evento.clientY + 16) + 'px';
  };

  for (const hit of caja.querySelectorAll('circle.hit')) {
    hit.addEventListener('pointerenter', (e) => { vivo = hit; mostrar(hit, e); });
    hit.addEventListener('pointermove', (e) => { if (vivo === hit) mostrar(hit, e); });
    hit.addEventListener('pointerleave', () => { vivo = null; tip.hidden = true; });
  }
  // The tooltip is fixed-position and the section it belongs to can be collapsed out from under
  // it, which would leave it floating over an unrelated part of the page.
  caja.closest('details').addEventListener('toggle', () => { tip.hidden = true; });
}

/* -------------------------------------------------------------------- cobertura */
async function renderCobertura(box) {
  const c = await api('/api/cobertura');
  box.append(el('div', 'hint',
    c.totales.matchups + ' matchups · ' + c.totales.reps + ' reps · ' +
    c.totales.mudos + ' sobre los que no puedo decir nada'));
  // The meta is either here, absent (normal), or present and unreadable (not normal). The
  // table below looks identical in all three cases, so the difference has to be said out loud.
  if (c.problemaPriors) box.append(el('div', 'dim', c.problemaPriors));

  const buscar = el('input');
  buscar.placeholder = 'filtrar campeón…';
  buscar.size = 16;
  box.append(buscar);

  const tabla = document.createElement('table');
  const head = document.createElement('tr');
  for (const h of ['matchup', 'acá', 'reps', 'confianza', 'falta']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  tabla.append(head);
  const filas = [];
  for (const f of c.filas) {
    const tr = document.createElement('tr');
    const cells = [
      f.campeon + ' vs ' + f.rival,
      String(f.propias),
      String(f.reps),
      f.confianza,
      f.faltan === 0 ? 'ya manda tu registro' : f.faltan + ' para ' + f.siguiente,
    ];
    for (const value of cells) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    tr.dataset.busca = (f.campeon + ' ' + f.rival).toLowerCase();
    filas.push(tr);
    tabla.append(tr);
  }
  buscar.oninput = () => {
    const q = buscar.value.trim().toLowerCase();
    for (const tr of filas) tr.hidden = q !== '' && !tr.dataset.busca.includes(q);
  };
  box.append(tabla);
  box.append(el('div', 'alcance',
    'alcance: ' + c.alcance.cuenta + ' · cola ' + c.alcance.cola + ' · remakes ' + c.alcance.remakes +
    '. Las reps se suman entre cuentas (conocimiento); el récord no (rendimiento, ADR-011).'));
}

/* ---------------------------------------------------------------------- el ledger */
async function renderLedger(box) {
  const hs = await api('/api/ledger');
  if (hs.length === 0) {
    box.append(el('div', 'vacio',
      'El ledger está vacío. Se registra desde scripts/register-hypotheses.ts.'));
    return;
  }
  box.append(el('div', 'hint',
    'Cada fila es una predicción con fecha, evaluada SÓLO contra partidas posteriores. ' +
    '"todavía sin muestra suficiente" durante meses es la respuesta correcta, no una herramienta rota.'));
  for (const h of hs) {
    const card = el('div', 'card plano');
    const cab = el('div', 'cabeza');
    cab.append(el('span', 'nombres', h.id));
    if (h.ultima) {
      const mal = h.ultima.veredicto === 'inconsistent' || h.ultima.veredicto === 'unmeasurable';
      cab.append(el('span', 'pill ' + (mal ? 'bad' : 'dim'), h.ultima.veredicto));
    }
    card.append(cab);
    card.append(el('div', null, h.claim));
    card.append(el('div', 'dim',
      'baseline ' + h.baseline.toFixed(3) + ' sobre n=' + h.baselineN +
      ' · necesita n=' + h.necesita +
      (h.ultima ? ' · última: ' + h.ultima.lectura + ' (n=' + h.ultima.n + ')' : ' · sin evaluar')));
    card.append(el('div', 'alcance', 'cautela: ' + h.cautela));
    box.append(card);
  }
}

/* ------------------------------------------------------------------ runas y clases
   Two dimensions that were already in the cache and had nothing reading them: the keystones
   have been in every match payload since the first sync, and the classes are one Data Dragon
   table. Neither costs a Riot request. */

/** A small bar so a column of counts is scannable. Same hue for every row: this is magnitude,
    not identity, and a colour per row would invite reading the hue as a category. */
function celdaBarra(valor, maximo) {
  const td = document.createElement('td');
  const barra = el('span', 'barrita');
  barra.style.width = Math.max(2, Math.round((valor / Math.max(1, maximo)) * 90)) + 'px';
  td.append(barra, document.createTextNode(' ' + valor));
  td.className = 'nums';
  return td;
}

function tablaKeystones(titulo, filas, nota) {
  const caja = el('div');
  caja.append(el('h3', null, titulo));
  if (filas.length === 0) {
    caja.append(el('div', 'vacio', 'Ninguna leída todavía.'));
    return caja;
  }
  const maximo = Math.max(...filas.map((f) => f.jugadas));
  const tabla = document.createElement('table');
  tabla.className = 'compacta';
  const head = document.createElement('tr');
  for (const h of ['keystone', 'árbol', 'partidas', 'ganadas', 'wr']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  tabla.append(head);
  for (const f of filas) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.append(runaIcono({ runeId: f.runeId, name: f.name }, true));
    tr.append(td0);
    const td1 = document.createElement('td');
    td1.textContent = f.treeName;
    td1.className = 'dim';
    tr.append(td1, celdaBarra(f.jugadas, maximo));
    for (const valor of [f.ganadas + '/' + f.jugadas,
                         Number.isFinite(f.winRate) ? Math.round(f.winRate * 100) + '%' : '—']) {
      const td = document.createElement('td');
      td.textContent = valor;
      td.className = 'nums';
      tr.append(td);
    }
    tabla.append(tr);
  }
  caja.append(tabla);
  if (nota) caja.append(el('div', 'alcance', nota));
  return caja;
}

async function renderRunas(box) {
  const r = await api('/api/runas');

  if (r.faltaCatalogo) {
    box.append(el('div', 'card plano',
      'Falta la tabla de runas del parche ' + r.faltaCatalogo + '. Corré lol catalogos: ' +
      'no gasta ni un request de Riot, sale de Data Dragon.'));
  }

  box.append(el('div', 'hint',
    'Las runas estaban guardadas en cada partida desde el primer sync y nada las leía. ' +
    'Esto no bajó nada de Riot: sólo una tabla por parche que dice qué significa cada id.'));

  box.append(tablaKeystones('las que llevás vos', r.mias,
    'DESCRIPCIÓN, no ranking. No elegís keystone al azar: la elegís por el matchup y por el ' +
    'campeón, así que su winrate se lleva puestas todas las razones por las que la elegiste. ' +
    'La columna de partidas está para que eso se lea solo.'));

  box.append(tablaKeystones('las que te tocaron enfrente', r.suyas,
    'Winrate TUYO en las partidas donde el rival llevó esa keystone — no el de él.'));

  if (r.clases.length > 0) {
    box.append(el('h3', null, 'contra qué clase de campeón'));
    const maximo = Math.max(...r.clases.map((c) => c.jugadas));
    const tabla = document.createElement('table');
    tabla.className = 'compacta';
    const head = document.createElement('tr');
    for (const h of ['clase', 'partidas', 'ganadas', 'wr']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.append(th);
    }
    tabla.append(head);
    for (const c of r.clases) {
      const tr = document.createElement('tr');
      const td0 = document.createElement('td');
      td0.textContent = c.etiqueta;
      tr.append(td0, celdaBarra(c.jugadas, maximo));
      for (const valor of [c.ganadas + '/' + c.jugadas,
                           Number.isFinite(c.winRate) ? Math.round(c.winRate * 100) + '%' : '—']) {
        const td = document.createElement('td');
        td.textContent = valor;
        td.className = 'nums';
        tr.append(td);
      }
      tabla.append(tr);
    }
    box.append(tabla);
    // Said out loud because a reader who adds the column and gets more than the game count
    // would be right to distrust the whole table.
    box.append(el('div', 'alcance',
      'La clase es lo único que se sabe ANTES de que empiece la partida, así que es el único ' +
      'agrupamiento de rivales que no se contamina con el resultado. Un campeón puede tener ' +
      'DOS clases (Diana es luchadora y asesina), así que las filas no suman ' + r.jugadas +
      '. Está toda la tabla a propósito: una fila sola no dice nada sin las otras.'));
  }

  const perdidas = r.sinLeer.mias + r.sinLeer.suyas;
  if (perdidas > 0 || r.sinClasificar > 0) {
    box.append(el('div', 'alcance',
      'Sin leer: ' + r.sinLeer.mias + ' keystone(s) tuyas, ' + r.sinLeer.suyas + ' del rival, ' +
      r.sinClasificar + ' partida(s) sin clase de rival identificada.'));
  }
}

/* ---------------------------------------------------------------- antes de entrar */
async function renderPrep(box) {
  box.append(el('div', 'hint',
    'Tu récord en esta cuenta, tus reps en todas, y el meta de op.gg. Separados a propósito: ' +
    'el conocimiento se suma entre cuentas, el rendimiento no.'));

  const fila = el('div', 'filtros');
  const mio = el('select');
  mio.title = 'tu campeón';
  const vacio = el('option', null, 'tu campeón…');
  vacio.value = '';
  mio.append(vacio);
  for (const c of CAMPEONES) {
    const o = el('option', null, c.valor);
    o.value = c.valor;
    mio.append(o);
  }
  const suyo = el('input');
  suyo.placeholder = 'el rival (ej. Zed)';
  suyo.size = 14;
  const boton = el('button', 'principal chico', 'Ver');
  fila.append(mio, suyo, boton);
  const salida = el('div');
  box.append(fila, salida);

  const consultar = async () => {
    if (!mio.value || !suyo.value) {
      salida.replaceChildren(el('div', 'vacio', 'Elegí tu campeón y escribí el rival.'));
      return;
    }
    salida.replaceChildren(el('div', 'vacio', 'buscando…'));
    try {
      const p = await api('/api/prep', { campeon: mio.value, rival: suyo.value.trim() });
      salida.replaceChildren();
      const card = el('div', 'card plano');
      const cab = el('div', 'cabeza');
      const a = cara(p.campeon, 'chico');
      if (a) cab.append(a);
      cab.append(el('span', 'vs', 'vs'));
      const b = cara(p.rival, 'chico');
      if (b) cab.append(b);
      cab.append(el('span', 'nombres', p.campeon + ' vs ' + p.rival));
      card.append(cab);

      const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
      const tiles = el('div', 'tiles');
      const tile = (k, v, sub) => {
        const t = el('div', 'tile');
        t.append(el('span', 'k', k));
        t.append(el('div', 'v nums', v));
        if (sub) t.append(el('div', 'vs', sub));
        tiles.append(t);
      };
      tile('en esta cuenta', p.propias.ganadas + '/' + p.propias.jugadas, 'rendimiento, no se suma');
      tile('reps totales', String(p.reps), 'conocimiento, sí se suma');
      tile('meta op.gg', p.meta === null ? '—' : pct(p.meta.winRate),
        p.meta === null ? 'sin prior' : 'sobre ' + p.meta.muestra + ' partidas');
      card.append(tiles);

      if (p.otrasCuentas.length > 0) {
        card.append(el('div', 'dim', p.otrasCuentas.map((o) =>
          'en ' + o.cuenta + ': ' + o.ganadas + '/' + o.jugadas).join(' · ') +
          ' — NO se suma: es rendimiento'));
      }
      card.append(el('h3', null, 'estimado con shrinkage'));
      card.append(el('div', 'nums', p.estimados.map((e) =>
        'peso ' + e.peso + ': ' + pct(e.winRate) + ' (' + pct(e.propio) + ' tuyo)').join('   ')));
      card.append(el('div', 'alcance', 'confianza: ' + p.confianza));
      salida.append(card);
    } catch (err) {
      salida.replaceChildren(el('div', 'vacio', 'No se pudo: ' + err.message));
    }
  };
  boton.onclick = consultar;
  suyo.onkeydown = (e) => { if (e.key === 'Enter') void consultar(); };
  salida.append(el('div', 'vacio', 'Elegí tu campeón y escribí el rival.'));
}

/* ------------------------------------------------------------------ cuentas y key */
async function renderCuentas(box) {
  const e = await api('/api/estado');

  for (const c of e.cuentas) {
    const card = el('div', 'card plano');
    const cab = el('div', 'cabeza');
    cab.append(el('span', 'nombres', c.label));
    if (c.label === ALCANCE.cuenta) cab.append(el('span', 'pill dim', 'viendo'));
    card.append(cab);
    const add = (k, v) => {
      const row = el('div', 'row');
      row.append(el('span', 'k', k), el('span', null, v));
      card.append(row);
    };
    for (const r of c.rango) {
      add(r.cola, r.texto + (r.wins === null ? '' : '  ' + r.wins + 'W-' + r.losses + 'L'));
    }
    add('sin taguear', String(c.pendientes));
    // Stated, not hidden: the decision left these behind and the panel says how many, so the
    // number never quietly becomes "there was nothing there".
    if (c.dejadasAtras > 0) add('dejadas atrás', c.dejadasAtras + ' (a propósito)');
    // Same principle: a game with no timeline is missing from almost every number on this page.
    if (c.sinTimeline > 0) add('sin timeline', c.sinTimeline + ' (sin datos por minuto)');
    add('último sync', c.ultimoSync === null ? 'nunca'
      : fechaHora(c.ultimoSync.at) + (c.ultimoSync.terminado ? '' : ' — no terminó') +
        (c.ultimoSync.error ? ' — ' + c.ultimoSync.error : ''));
    box.append(card);
  }

  const card = el('div', 'card plano');
  card.append(el('div', 't', 'key de riot'));
  const k = e.key;
  card.append(el('div', k.presente ? (k.probablementeVencida ? 'warn' : 'ok') : 'bad',
    k.presente ? (k.probablementeVencida ? 'presente pero probablemente vencida' : 'presente')
      : 'no hay key'));
  if (k.horasDesdeQueSePego !== null) {
    card.append(el('div', 'dim', 'pegada hace ' + k.horasDesdeQueSePego.toFixed(0) + ' h · tipo ' + k.tipo));
  }
  if (k.problema) card.append(el('div', 'dim', k.problema));
  card.append(el('div', 'alcance', 'archivo: ' + k.archivo + '. El valor nunca llega al navegador.'));
  box.append(card);
}

/* ------------------------------------------------------------------- primera vez
   Before this existed, a fresh cache made the page a wall: /api/estado answered with an
   empty account list and every reading section 404'd, one error at a time, with nothing to
   do about any of them. */
function renderPrimeraVez() {
  const box = document.getElementById('primera-vez');
  box.replaceChildren();
  const card = el('div', 'destacada');
  const txt = el('div', 'txt');
  txt.append(el('div', 'que', 'Empezá por acá'));
  txt.append(el('div', 'porque',
    'No hay ninguna cuenta todavía. Poné tu Riot ID como aparece en el cliente (Nombre#TAG) ' +
    'y una etiqueta corta para llamarla después.'));

  const riotId = el('input');
  riotId.placeholder = 'LegendofTorcuato#LAS';
  riotId.size = 24;
  const etiqueta = el('input');
  etiqueta.placeholder = 'smurf';
  etiqueta.size = 10;
  const boton = el('button', 'principal', 'Registrar');
  const salida = el('div', 'log');
  const fila = el('div', 'acciones');
  fila.append(riotId, etiqueta, boton);
  txt.append(fila, salida);
  card.append(txt);
  box.append(card);

  const registrar = async () => {
    if (!riotId.value) return;
    boton.disabled = true;
    salida.textContent = 'preguntándole a Riot…';
    try {
      const r = await post('/api/cuenta', { riotId: riotId.value, label: etiqueta.value });
      aviso(r.gameName + '#' + r.tagLine + ' guardada como ' + r.label + '.', 'bien');
      ALCANCE.cuenta = r.label;
      guardarAlcance();
      await arrancar();
    } catch (err) {
      // The likeliest failure by far is a missing or expired key, and the message from the
      // client already says so — repeating it here is what stops this looking like a bad ID.
      salida.textContent = 'Error: ' + err.message;
      boton.disabled = false;
    }
  };
  boton.onclick = registrar;
  riotId.onkeydown = (e) => { if (e.key === 'Enter') void registrar(); };
}

/* ---------------------------------------------------------------------- atajos
   The ritual is one tap per game (ADR-007) and the mouse is the slow way to do it. Nothing
   here does anything a button does not already do, which is the rule: a shortcut is a faster
   path to a visible control, never the only path to a hidden one. */
const ATAJOS = [
  ['1 · 2 · 3', 'taguear la primera partida pendiente'],
  ['s', 'sincronizar'],
  ['p', 'ir a las partidas'],
  ['e', 'expandir todo · E contraer todo'],
  ['?', 'esta ayuda'],
];

function atajos(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;

  if (e.key === '1' || e.key === '2' || e.key === '3') {
    if (!tarjetaEnFoco) return;
    const boton = [...tarjetaEnFoco.children].find((b) => b.dataset.tecla === e.key);
    if (boton && !boton.disabled) { boton.click(); e.preventDefault(); }
    return;
  }
  if (e.key === 's') { abrirSeccion('sync'); lanzarSync(); e.preventDefault(); return; }
  if (e.key === 'p') { abrirSeccion('partidas'); e.preventDefault(); return; }
  if (e.key === 'e') { for (const s of SECCIONES) s.det.open = true; e.preventDefault(); return; }
  if (e.key === 'E') { for (const s of SECCIONES) s.det.open = false; e.preventDefault(); return; }
  if (e.key === '?') { abrirSeccion('ayuda'); e.preventDefault(); }
}

function renderAyuda(box) {
  box.append(el('div', 'hint', 'Todo lo de acá también se hace con el mouse.'));
  const grid = el('div', 'teclas');
  for (const [tecla, que] of ATAJOS) {
    grid.append(el('kbd', null, tecla));
    grid.append(el('span', null, que));
  }
  box.append(grid);
  box.append(el('h3', null, 'cómo leer esta página'));
  const notas = [
    'El panel escucha sólo en 127.0.0.1 y la URL lleva un token que cambia en cada arranque: ' +
      'guardar el favorito no sirve. Mientras la ventana negra esté abierta, esto anda.',
    'Las secciones se acuerdan de si las dejaste abiertas, y cada una se calcula recién cuando ' +
      'la abrís. Por eso el número que ves en el título vale aunque esté cerrada.',
    'Arriba elegís cuenta, rol y cola: TODO lo de abajo se lee con ese filtro, y queda en la URL.',
    'Ninguna métrica que suba porque vas ganando tiene tarjeta destacada. Están abajo, como ' +
      'descripción, nunca como conclusión.',
  ];
  for (const n of notas) box.append(el('div', 'dim', '· ' + n));
}

/* ---------------------------------------------------------------------- arranque */
let SECCIONES_ARMADAS = false;

function armarSecciones() {
  if (SECCIONES_ARMADAS) return;
  SECCIONES_ARMADAS = true;
  const box = document.getElementById('secciones');
  const abiertas = leerAbiertas();

  const defs = [
    ['resumen', 'Cómo viene', renderResumen, true, (e) => null],
    ['taguear', 'Taguear', renderPendientes, false, (e) => {
      const n = e ? e.cuentas.reduce((a, c) => a + c.pendientes, 0) : 0;
      return n > 0
        ? { badge: String(n), tono: 'urgente', texto: 'sin taguear' }
        : { badge: 'al día', tono: 'bien', texto: '' };
    }],
    ['sync', 'Sincronizar', renderSync, false, (e) => {
      if (!e) return null;
      const c = e.cuentas.find((x) => x.label === ALCANCE.cuenta) || e.cuentas[0];
      if (!c) return null;
      return { badge: '', texto: c.ultimoSync === null ? 'nunca sincronizada'
        : 'último: ' + fechaHora(c.ultimoSync.at) };
    }],
    ['partidas', 'Partidas', renderPartidas, false, () => ({ badge: '', texto: 'buscar y filtrar' })],
    ['momentos', 'Lo que salió caro', renderMomentos, false, () => ({ badge: '', texto: 'últimas 5' })],
    ['graficos', 'Curva y mapa de muertes', renderGraficos, false, () => null],
    ['runas', 'Runas y clases', renderRunas, false, () => ({ badge: 'nuevo', tono: 'bien',
      texto: 'keystones y contra qué clase' })],
    ['prep', 'Antes de entrar', renderPrep, false, () => ({ badge: '', texto: 'matchup' })],
    ['cobertura', 'De qué no puedo hablar', renderCobertura, false, () => null],
    ['ledger', 'Hipótesis registradas', renderLedger, false, () => null],
    ['cuentas', 'Cuentas y key', renderCuentas, false, (e) => {
      if (!e || !e.key) return null;
      return e.key.presente && !e.key.probablementeVencida
        ? { badge: '', texto: 'key ok' }
        : { badge: 'key', tono: 'urgente', texto: e.key.presente ? 'probablemente vencida' : 'falta' };
    }],
    ['ayuda', 'Atajos y cómo leer esto', renderAyuda, false, () => null],
  ];

  for (const [id, titulo, render, abiertaPorDefecto, resumir] of defs) {
    const s = seccion(id, titulo, render, { resumir });
    box.append(s.det);
    // First visit: only the summary is open. After that his own choice wins, including the
    // choice to close the summary — a panel that reopens what you closed is a panel you fight.
    const guardada = localStorage.getItem(ABIERTAS) !== null;
    s.det.open = guardada ? abiertas.has(id) : abiertaPorDefecto;
  }
}

/**
 * Draws the page for the state the cache is actually in.
 *
 * With no accounts the sections are not rendered at all, rather than rendered and allowed to
 * fail: five 404s about an account nobody claimed exists are not five problems, and showing
 * them as errors buries the ONE thing to do behind noise.
 */
async function arrancar() {
  let estado;
  try {
    estado = await api('/api/estado');
  } catch (err) {
    fallar(err);
    return;
  }

  const vacia = estado.cuentas.length === 0;
  document.getElementById('primera-vez').hidden = !vacia;
  document.getElementById('secciones').hidden = vacia;
  document.getElementById('scope').hidden = vacia;
  if (vacia) {
    document.getElementById('ahora').replaceChildren();
    renderPrimeraVez();
    return;
  }

  // The scope has to name a REAL account before anything is fetched with it, and the default
  // comes from the server so the page and the API cannot disagree about which one that is.
  if (!ALCANCE.cuenta || !estado.cuentas.some((c) => c.label === ALCANCE.cuenta)) {
    ALCANCE.cuenta = estado.cuentaPorDefecto || estado.cuentas[0].label;
    guardarAlcance();
  }

  renderAhora(estado.acciones);
  // Whether this is the first paint decides who renders the open sections: on the first one
  // armarSecciones opens them and the toggle handler paints, so repainting here would fetch
  // every open section twice. On a re-run (an account switch, a finished sync) the sections
  // already exist and stale bodies are exactly what has to be thrown away.
  const primeraVez = !SECCIONES_ARMADAS;

  try {
    const f = await api('/api/filtros');
    CAMPEONES = f.campeones;
    renderScope(f);
  } catch (err) { fallar(err); }

  armarSecciones();
  if (!primeraVez) for (const s of SECCIONES) s.redibujar();
  await refrescarSecciones(estado);

  // Tagging is the only input that cannot be recovered later, so it is the one section the
  // page opens on its own — and only while there is actually something pending.
  const pendientes = estado.cuentas.reduce((a, c) => a + c.pendientes, 0);
  if (pendientes > 0) {
    const s = SECCIONES.find((x) => x.id === 'taguear');
    if (s && !s.det.open) s.det.open = true;
  }
}

/** The cheap refresh: state and badges only, no section is repainted under his hands. */
async function refrescar() {
  try {
    const estado = await api('/api/estado');
    renderAhora(estado.acciones);
    await refrescarSecciones(estado);
  } catch (err) { /* a background poll must never shout */ }
}

document.addEventListener('keydown', atajos);
void arrancar();
// Every 60s, and only the state and the badges — it reads the database and spends no Riot
// request, so polling it cannot eat the rate limit the sync needs. It deliberately does NOT
// repaint an open section: re-rendering the tag list under his hands would reset the buttons
// mid-ritual and lose his place.
setInterval(() => { if (!document.hidden && !syncCorriendo) void refrescar(); }, 60000);

`;

/**
 * The document.
 *
 * The client script is injected RAW, and it has to be: inside a script element the HTML parser
 * does not decode entities, so HTML-escaping the script turns every arrow function into an
 * entity and the page loads a syntax error in silence — a blank panel with an empty console,
 * which is exactly what happened the one time it was tried. There is nothing to escape anyway:
 * the content is a compile-time constant, never user data. The one sequence that WOULD end the
 * element early is a literal closing script tag, and a test asserts the script has none.
 */
export function renderShell(token: string | null): string {
  if (token === null) {
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>lol</title><style>${CLIENT_STYLE}</style></head>
<body><div class="wrap">
<h1>Falta el token</h1>
<p class="sub">Abrí la URL que imprimió <code>pnpm lol ui</code> — lleva un <code>?t=</code> al final.
El token cambia en cada arranque, así que un favorito viejo no sirve.</p>
</div></body></html>`;
  }

  // The token is NOT written into the document: the script reads it from the address bar, so a
  // screenshot of the page leaks nothing the URL bar does not already show.
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lol</title>
<style>${CLIENT_STYLE}</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="fila">
      <div class="marca">
        <h1>lol</h1>
        <p class="sub">Local, en tu máquina. Nada de esto sale de acá.</p>
      </div>
      <div class="scope" id="scope"></div>
    </div>
  </div>

  <div id="primera-vez" hidden></div>
  <div id="ahora"></div>
  <div id="secciones"></div>
</div>
<div class="avisos" id="avisos"></div>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
