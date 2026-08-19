/**
 * The page itself: one HTML document with its CSS and JS inline.
 *
 * No framework and no build step, consistent with ADR-003 and with ADR-014's reasoning for the
 * static page — a panel with buttons over a local JSON API is not a thing that needs a bundler.
 * The document is a SHELL: it ships no data, and everything it shows comes from `/api/*`, so
 * there is exactly one place where each number is produced.
 */

import { SVG_STYLE, SVG_VARS_DARK } from '../analysis/render.ts';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Exported so a test can assert it carries the rules the SVG builders need. */
export const CLIENT_STYLE = `
:root {
  color-scheme: dark;
  --bg: #0f1115;
  --card: #171a21;
  --line: #262b36;
  --ink: #e8eaf0;
  --dim: #9aa3b2;
  --ok: #5ec27a;
  --warn: #e0b450;
  --bad: #e06c6c;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px;
  background: var(--bg); color: var(--ink);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 28px 0 10px; color: var(--dim); font-weight: 600;
     text-transform: uppercase; letter-spacing: .06em; }
.wrap { max-width: 900px; margin: 0 auto; }
.sub { color: var(--dim); margin: 0 0 24px; font-size: 13px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
        padding: 14px 16px; margin-bottom: 10px; }
.accion { display: flex; gap: 14px; align-items: flex-start; }
.accion .txt { flex: 1; min-width: 0; }
.accion .que { font-weight: 600; }
.accion .porque { color: var(--dim); font-size: 13px; margin-top: 2px; }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 7px; flex: none; }
.dot.ahora { background: var(--bad); }
.dot.cuando_puedas { background: var(--warn); }
.ok { color: var(--ok); }
.dim { color: var(--dim); }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
.row .k { color: var(--dim); }
code { background: #0b0d11; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
.err { border-color: var(--bad); color: var(--bad); }
button {
  font: inherit; color: var(--ink); background: #202634;
  border: 1px solid var(--line); border-radius: 7px;
  padding: 6px 12px; cursor: pointer;
}
button:hover { background: #2a3242; }
button:disabled { opacity: .45; cursor: default; }
button.on { background: #2f4d38; border-color: var(--ok); }
.partida { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.partida .quien { flex: 1; min-width: 180px; }
.partida .cuando { color: var(--dim); font-size: 13px; }
.derrota { color: var(--bad); }
.victoria { color: var(--ok); }
.tags { display: flex; gap: 6px; }
.hint { color: var(--dim); font-size: 13px; margin: 0 0 10px; }
.barra { height: 6px; background: #0b0d11; border-radius: 3px; overflow: hidden; margin-top: 10px; }
.barra > div { height: 100%; background: var(--ok); width: 0; transition: width .2s; }
.log { color: var(--dim); font-size: 13px; margin-top: 8px; white-space: pre-wrap; }
/* Champion portraits. Square art, rounded, with a ring that says who won. */
.face { width: 34px; height: 34px; border-radius: 8px; flex: none; background: #0b0d11;
        border: 1px solid var(--line); object-fit: cover; }
.face.chico { width: 24px; height: 24px; border-radius: 6px; }
.face.gano { border-color: var(--ok); }
.face.perdio { border-color: var(--bad); }
.duelo { display: flex; align-items: center; gap: 8px; }
.duelo .vs { color: var(--dim); font-size: 12px; }
.cabeza { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.cabeza .nombres { font-weight: 600; }
.pill { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; font-weight: 600;
        border-radius: 999px; padding: 2px 9px; border: 1px solid currentColor; }
.momento { font-variant-numeric: tabular-nums; padding: 3px 0; }
.momento .min { color: var(--warn); }
/* The build: two rows of item icons with the minute under each, his and his opponent's. */
.build { display: grid; grid-template-columns: 3.6em 1fr; gap: 6px 10px; margin: 10px 0 4px;
         align-items: center; font-variant-numeric: tabular-nums; font-size: 12px; }
.build .k { color: var(--dim); font-size: 12px; }
.items { display: flex; gap: 8px; flex-wrap: wrap; }
.item { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 44px; }
.item img { width: 40px; height: 40px; border-radius: 7px; border: 1px solid var(--line);
            background: #0b0d11; }
.item .min { color: var(--dim); font-size: 11px; }
.item.tarde img { border-color: var(--warn); }
.tag { font-size: 12px; color: var(--dim); border: 1px solid var(--line);
       border-radius: 5px; padding: 1px 6px; margin-left: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--dim); font-weight: 600; padding: 4px 8px 4px 0; }
td { padding: 3px 8px 3px 0; border-top: 1px solid var(--line); }
.alcance { color: var(--dim); font-size: 12px; margin-top: 8px; }
.foco { border-left: 3px solid var(--warn); }
.foco .claim { margin: 6px 0; }
.guardada { color: var(--dim); font-size: 12px; margin-top: 4px; }
.anotado { color: var(--warn); font-size: 12px; margin-top: 8px; }
input { font: inherit; color: var(--ink); background: #0b0d11; border: 1px solid var(--line);
        border-radius: 7px; padding: 6px 10px; width: 150px; }
.svgbox { overflow-x: auto; }

/* The SVG builders carry no presentation of their own - they emit classes. Pulled in from
   render.ts rather than restated, so the static page and this one cannot drift apart, and an
   SVG here cannot silently render as black-on-black the way it did before. */
${SVG_VARS_DARK}
${SVG_STYLE}
`;

/**
 * The client script, exported ONLY so a test can parse it.
 *
 * It lives inside a template literal, which means a syntax error in it is invisible to tsc, to
 * Biome and to Vitest alike — the page would simply do nothing, with a clean build and a clean
 * suite. `tests/ui.test.ts` compiles it with `new Function` for exactly that reason. Same class
 * of blind spot G-018 was born from: the verify chain does not look inside strings.
 */
export const CLIENT_SCRIPT = `
const TOKEN = new URLSearchParams(location.search).get('t');
const api = (path) => fetch(path + (path.includes('?') ? '&' : '?') + 't=' + TOKEN)
  .then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    return body;
  });

/* A champion portrait, or nothing if the art is missing: the name is always in the text
   beside it, so a 404 has to degrade to plain text rather than to a broken-image icon. */
const cara = (campeon, cls) => {
  if (!campeon) return null;
  const img = document.createElement('img');
  img.className = 'face' + (cls ? ' ' + cls : '');
  img.src = '/img/champion/' + encodeURIComponent(campeon) + '.png';
  img.alt = campeon;
  img.title = campeon;
  img.loading = 'lazy';
  img.onerror = () => img.remove();
  return img;
};

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

function renderAcciones(acciones) {
  const box = document.getElementById('acciones');
  box.replaceChildren();
  if (acciones.length === 0) {
    const card = el('div', 'card');
    card.append(el('div', 'ok', 'Nada pendiente. Todo al día.'));
    box.append(card);
    return;
  }
  for (const a of acciones) {
    const card = el('div', 'card accion');
    card.append(el('div', 'dot ' + a.urgencia));
    const txt = el('div', 'txt');
    txt.append(el('div', 'que', a.que));
    txt.append(el('div', 'porque', a.porque));
    card.append(txt);
    box.append(card);
  }
}

function renderCuentas(cuentas) {
  const box = document.getElementById('cuentas');
  box.replaceChildren();
  for (const c of cuentas) {
    const card = el('div', 'card');
    card.append(el('div', 'que', c.label));
    const add = (k, v) => {
      const row = el('div', 'row');
      row.append(el('span', 'k', k));
      row.append(el('span', null, v));
      card.append(row);
    };
    add('sin taguear', String(c.pendientes));
    // Stated, not hidden: the decision left these behind and the panel says how many, so the
    // number never quietly becomes "there was nothing there".
    if (c.dejadasAtras > 0) add('dejadas atrás', String(c.dejadasAtras) + ' (a propósito)');
    add(
      'último sync',
      c.ultimoSync === null
        ? 'nunca'
        : new Date(c.ultimoSync.at).toLocaleString('es-AR', { hourCycle: 'h23' }) +
            (c.ultimoSync.terminado ? '' : ' (no terminó)') +
            (c.ultimoSync.error ? ' — ' + c.ultimoSync.error : ''),
    );
    for (const r of c.rango) {
      add(r.cola, r.texto + (r.wins === null ? '' : ' (' + r.wins + 'W-' + r.losses + 'L)'));
    }
    box.append(card);
  }
}

function renderKey(key) {
  const box = document.getElementById('key');
  box.replaceChildren();
  const card = el('div', 'card' + (key.problema ? ' err' : ''));
  if (!key.presente) {
    card.append(el('div', null, 'No hay key.'));
  } else {
    const horas = key.horasDesdeQueSePego;
    card.append(
      el(
        'div',
        key.probablementeVencida ? null : 'ok',
        'Key ' + key.tipo + (horas === null ? '' : ' — pegada hace ' + Math.floor(horas) + ' h'),
      ),
    );
  }
  if (key.problema) card.append(el('div', 'porque', key.problema));
  box.append(card);
}

const post = (path, body) => fetch(path + (path.includes('?') ? '&' : '?') + 't=' + TOKEN, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
}).then(async (r) => {
  const parsed = await r.json();
  if (!r.ok) throw new Error(parsed.error || r.statusText);
  return parsed;
});

const TAGS = [
  ['mía', 'La produje yo'],
  ['igual', 'Salía igual'],
  ['pareja', 'Estuvo pareja'],
];

let sesion = null;

function tarjetaPartida(p, alTaguear) {
  const card = el('div', 'card partida');
  /* The portrait is the fastest way to recognise WHICH game this was: he remembers the champion
     he played long before he remembers the timestamp. */
  const retrato = cara(p.campeon, p.gano ? 'gano' : 'perdio');
  if (retrato) card.append(retrato);
  const quien = el('div', 'quien');
  quien.append(el('span', null, p.campeon + '  '));
  quien.append(el('span', p.gano ? 'victoria' : 'derrota', p.gano ? 'victoria' : 'DERROTA'));
  quien.append(el('div', 'cuando',
    new Date(p.terminoAt).toLocaleString('es-AR', { hourCycle: 'h23' })));
  card.append(quien);

  const tags = el('div', 'tags');
  for (const [valor, etiqueta] of TAGS) {
    const b = el('button', null, etiqueta);
    b.onclick = async () => {
      for (const otro of tags.children) otro.disabled = true;
      try {
        // One request per game, and the tag is on disk before this resolves.
        if (sesion === null) sesion = (await post('/api/sesion/abrir')).sesion;
        await post('/api/tag', { matchId: p.matchId, tag: valor, sesion });
        b.classList.add('on');
        setTimeout(alTaguear, 350);
      } catch (err) {
        document.getElementById('error').textContent = 'Error: ' + err.message;
        for (const otro of tags.children) otro.disabled = false;
      }
    };
    tags.append(b);
  }
  card.append(tags);
  return card;
}

async function renderPendientes() {
  const box = document.getElementById('pendientes');
  box.replaceChildren();
  const { deLaSesion, atrasadas } = await api('/api/pendientes');

  const refrescarTodo = () => { void renderPendientes(); void refrescar(); };

  if (deLaSesion.length === 0 && atrasadas.length === 0) {
    const card = el('div', 'card');
    card.append(el('div', 'ok', 'Nada sin taguear.'));
    box.append(card);
    document.getElementById('tilt').replaceChildren();
    return;
  }

  if (deLaSesion.length > 0) {
    box.append(el('p', 'hint',
      'Más viejas primero, en el orden en que las jugaste. Cada click se guarda en el momento: ' +
      'si cerrás la pestaña a la mitad, lo que ya marcaste queda.'));
    for (const p of deLaSesion) box.append(tarjetaPartida(p, refrescarTodo));
  } else {
    box.append(el('p', 'hint', 'Nada de las últimas 12 horas.'));
  }

  // The backlog is FOLDED, not dropped. Tagging a two-week-old game is recall rather than
  // observation and the lag column will say so; hiding the pile entirely would be deciding for
  // him, showing it open would bury tonight's games under it.
  if (atrasadas.length > 0) {
    const abrir = el('button', null,
      'Ver ' + atrasadas.length + ' partida(s) más viejas');
    const viejas = el('div');
    const nota = el('p', 'hint',
      'Tienen más de 12 horas. Taguearlas es acordarse, no observar — queda anotado cuánto ' +
      'tardaste, así que no se mezclan con las de recién.');
    abrir.onclick = () => {
      abrir.remove();
      viejas.append(nota);
      for (const p of atrasadas) viejas.append(tarjetaPartida(p, refrescarTodo));
    };
    // The other honest answer to a backlog, and the one he actually gave: he does not remember
    // those games. It writes a dated decision, it does not delete anything, and the panel stops
    // demanding something that cannot be done well.
    const dejar = el('button', null, 'No las voy a taguear');
    dejar.onclick = async () => {
      dejar.disabled = true;
      dejar.textContent = 'anotando…';
      try {
        const r = await post('/api/dejar-atras');
        refrescarTodo();
        alert('Anotado: ' + r.dejadasAtras + ' partida(s) quedan sin taguear a propósito. ' +
          'Las que juegues de ahora en más aparecen acá.');
      } catch (e) {
        dejar.disabled = false;
        dejar.textContent = 'No las voy a taguear';
        alert('No se pudo: ' + e.message);
      }
    };
    box.append(abrir, dejar, viejas);
  }

  renderTilt();
}

function renderTilt() {
  const box = document.getElementById('tilt');
  box.replaceChildren();
  const card = el('div', 'card');
  card.append(el('div', 'que', 'Tilt de la sesión'));
  card.append(el('div', 'porque',
    'Cómo terminaste. "No contesto" no es un 3 del medio: queda sin medir, que es distinto.'));
  const row = el('div', 'tags');
  for (const n of [1, 2, 3, 4, 5]) {
    const b = el('button', null, String(n));
    b.onclick = () => guardarTilt(n, row);
    row.append(b);
  }
  const skip = el('button', null, 'No contesto');
  skip.onclick = () => guardarTilt(null, row);
  row.append(skip);
  card.append(row);
  box.append(card);
}

async function guardarTilt(tilt, row) {
  try {
    if (sesion === null) sesion = (await post('/api/sesion/abrir')).sesion;
    await post('/api/sesion/cerrar', { sesion, tilt });
    sesion = null;
    for (const b of row.children) b.disabled = true;
  } catch (err) {
    document.getElementById('error').textContent = 'Error: ' + err.message;
  }
}

function renderSync() {
  const box = document.getElementById('sync');
  box.replaceChildren();
  const card = el('div', 'card');
  const boton = el('button', null, 'Sincronizar ahora');
  const barra = el('div', 'barra');
  const relleno = el('div');
  barra.append(relleno);
  const log = el('div', 'log');
  card.append(boton, barra, log);
  box.append(card);

  boton.onclick = () => {
    boton.disabled = true;
    log.textContent = 'conectando…';
    relleno.style.width = '0';

    // EventSource cannot send headers, which is exactly why the token lives in the query string
    // rather than in an Authorization header.
    const src = new EventSource('/api/sync?t=' + TOKEN + '&cuenta=smurf');
    src.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (e.tipo === 'inicio') log.textContent = 'sincronizando ' + e.cuenta + '…';
      if (e.tipo === 'progreso') {
        relleno.style.width = (e.total === 0 ? 0 : (e.hechas / e.total) * 100) + '%';
        log.textContent = e.hechas + ' de ' + e.total;
      }
      if (e.tipo === 'fin') {
        relleno.style.width = '100%';
        log.textContent =
          e.bajadas + ' nueva(s), ' + e.timelines + ' timeline(s), ' + e.remakes + ' remake(s)' +
          (e.errores.length ? '\\n' + e.errores.slice(0, 3).join('\\n') : '');
        src.close();
        boton.disabled = false;
        void renderPendientes();
        void refrescar();
        void renderMomentos();
        void renderGraficos();
        void renderCobertura();
      }
      if (e.tipo === 'error') {
        log.textContent = 'no corrió: ' + e.mensaje;
        src.close();
        boton.disabled = false;
      }
    };
    // Fires when the stream drops without a 'fin' — a dead key, a closed laptop. The button has
    // to come back, or the page is bricked until a reload.
    src.onerror = () => {
      src.close();
      boton.disabled = false;
      if (!log.textContent || log.textContent === 'conectando…') {
        log.textContent = 'se cortó la conexión con el servidor';
      }
    };
  };
}

async function renderMomentos() {
  const box = document.getElementById('momentos');
  box.replaceChildren();
  const partidas = await api('/api/momentos');
  if (partidas.length === 0) {
    box.append(el('div', 'card dim', 'No hay partidas de mid en soloq en la caché.'));
    return;
  }
  for (const p of partidas) {
    const card = el('div', 'card');
    const head = el('div', 'cabeza');
    const mia = cara(p.campeon, p.gano ? 'gano' : 'perdio');
    if (mia) head.append(mia);
    const nombres = el('div', 'nombres');
    nombres.append(el('span', null, p.campeon));
    if (p.rival) {
      nombres.append(el('span', 'vs', '  vs  '));
      nombres.append(el('span', null, p.rival));
    }
    head.append(nombres);
    const suya = cara(p.rival, 'chico');
    if (suya) head.append(suya);
    const pill = el('span', 'pill ' + (p.gano ? 'victoria' : 'derrota'), p.gano ? 'victoria' : 'derrota');
    pill.style.marginLeft = 'auto';
    head.append(pill);
    if (p.tag) head.append(el('span', 'tag', p.tag));
    card.append(head);
    card.append(el('div', 'cuando',
      new Date(p.at).toLocaleString('es-AR', { hourCycle: 'h23' })));

    if (p.sinTimeline) {
      card.append(el('div', 'porque', 'sin timeline en caché — nada que derivar'));
    } else if (p.momentos.length === 0) {
      card.append(el('div', 'porque', 'sin momentos medibles'));
    } else {
      for (const m of p.momentos) {
        const row = el('div', 'momento');
        row.append(el('span', 'min', 'min ' + m.minuto + '  '));
        row.append(el('span', null, m.linea + '  [' + m.oro + ' de oro]'));
        card.append(row);
      }
    }
    // The build sits under the moments and above the caveats: it is the same game read from
    // another angle, and the timing only means something next to how the game was going.
    if (p.items && p.items.mios.length > 0) {
      const fila = (pasos) => {
        const box = el('div', 'items');
        if (pasos.length === 0) { box.append(el('span', 'dim', '—')); return box; }
        for (const paso of pasos) {
          const celda = el('div', 'item');
          const img = document.createElement('img');
          img.src = '/img/item/' + paso.id + '.png';
          img.alt = paso.nombre;
          img.title = paso.nombre + ' — ' + paso.min;
          img.loading = 'lazy';
          img.onerror = () => { celda.replaceChildren(el('span', null, paso.nombre)); };
          celda.append(img);
          celda.append(el('span', 'min', paso.min));
          box.append(celda);
        }
        return box;
      };
      const build = el('div', 'build');
      build.append(el('div', 'k', 'vos'));
      build.append(fila(p.items.mios));
      build.append(el('div', 'k', 'rival'));
      build.append(fila(p.items.suyos));
      card.append(build);
      if (p.items.primerItemMin !== null) {
        const g = p.items.primerItemMin;
        card.append(el('div', 'porque',
          'primer ítem ' + (g >= 0 ? '+' : '') + g.toFixed(1) + ' min' +
          (g > 0 ? ' — él llegó primero' : g < 0 ? ' — llegaste primero' : ' — empate')));
      }
    } else if (p.items === null && !p.sinTimeline) {
      card.append(el('div', 'porque', 'ítems: falta el catálogo de ese parche (lol items)'));
    }
    if (p.sinMedir > 0) {
      card.append(el('div', 'porque',
        p.sinMedir + ' muerte(s) sin ventana de 2 min por delante, no rankeadas'));
    }
    box.append(card);
  }
  box.append(el('p', 'hint',
    'Los replays .rofl se rompen al cambiar de parche: esto sirve dentro de la semana.'));
}

async function renderGraficos() {
  const box = document.getElementById('graficos');
  box.replaceChildren();
  const g = await api('/api/graficos');
  if (g.curva) {
    const card = el('div', 'card');
    card.append(el('div', 'que', 'Oro contra tu rival de línea'));
    const holder = el('div', 'svgbox');
    holder.innerHTML = g.curva;
    card.append(holder);
    box.append(card);
  }
  const card = el('div', 'card');
  card.append(el('div', 'que', 'Dónde morís'));
  card.append(el('div', 'porque',
    g.muertes + ' muertes en ' + g.partidas + ' partidas · ' +
    g.propiaMitad + ' en tu mitad, ' + (g.muertes - g.propiaMitad) + ' en la enemiga'));
  const holder = el('div', 'svgbox');
  holder.innerHTML = g.mapa;
  card.append(holder);
  box.append(card);
}

async function renderCobertura() {
  const box = document.getElementById('cobertura');
  box.replaceChildren();
  const c = await api('/api/cobertura');
  const card = el('div', 'card');
  card.append(el('div', 'porque',
    c.totales.matchups + ' matchups · ' + c.totales.reps + ' reps · ' +
    c.totales.mudos + ' sobre los que no puedo decir nada'));

  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const h of ['matchup', 'acá', 'reps', 'confianza', 'falta']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  table.append(head);
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
    table.append(tr);
  }
  card.append(table);
  // The scope travels with the numbers, always (G-015).
  card.append(el('div', 'alcance',
    'alcance: cuenta ' + c.alcance.cuenta + ' · cola ' + c.alcance.cola +
    ' · remakes ' + c.alcance.remakes +
    ' · las reps se suman entre cuentas, el récord no'));
  box.append(card);
}

async function renderAntes() {
  const box = document.getElementById('antes');
  box.replaceChildren();
  const b = await api('/api/antes');

  if (b.focus === null) {
    // El silencio se explica siempre. Un panel que no dice nada y no dice por qué se lee como
    // que no encontró nada, que es lo contrario de lo que pasó.
    box.append(el('div', 'card dim', b.noFocusReason || 'Nada registrado que mostrar.'));
  } else {
    const card = el('div', 'card foco');
    card.append(el('div', 'que', b.focus.id));
    card.append(el('div', 'claim', b.focus.claim));
    card.append(el('div', 'porque', 'cautela: ' + b.focus.caveat));
    card.append(el('div', 'porque',
      'le faltan ' + b.focus.shortfall + ' mediciones · ' + b.focus.why));
    card.append(el('div', 'anotado', b.focus.alreadyExposed
      ? 'Ya la habías visto: esta fila arrastra que te la dije antes de jugar.'
      : 'ANOTADO: desde ahora esta fila arrastra que te la dije antes de jugar.'));
    box.append(card);
  }

  if (b.withheld.length > 0) {
    // En su propia tarjeta y no como texto suelto: es una decisión del motor, no una nota al pie.
    const guardadas = el('div', 'card');
    guardadas.append(el('div', 'porque', 'Guardadas, a propósito:'));
    for (const w of b.withheld) {
      guardadas.append(el('div', 'guardada', w.reason === 'sin_evaluar'
        ? w.id + ' — nunca se evaluó, y la exposición no se deshace'
        : w.id + ' — le faltan ' + w.shortfall + ', todavía puede dar un veredicto limpio'));
    }
    box.append(guardadas);
  }
}

async function renderLedger() {
  const box = document.getElementById('ledger');
  box.replaceChildren();
  const hs = await api('/api/ledger');
  if (hs.length === 0) {
    box.append(el('div', 'card dim', 'El ledger está vacío.'));
    return;
  }
  for (const h of hs) {
    const card = el('div', 'card');
    card.append(el('div', 'que', h.id));
    card.append(el('div', null, h.claim));
    card.append(el('div', 'porque',
      'baseline ' + h.baseline.toFixed(3) + ' sobre n=' + h.baselineN +
      ' · necesita n=' + h.necesita +
      (h.ultima ? ' · última: ' + h.ultima.veredicto + ' (n=' + h.ultima.n + ')' : ' · sin evaluar')));
    card.append(el('div', 'alcance', 'cautela: ' + h.cautela));
    box.append(card);
  }
}

function renderPrep() {
  const box = document.getElementById('prep');
  box.replaceChildren();
  const card = el('div', 'card');
  const mio = el('input');
  mio.placeholder = 'tu campeón';
  const suyo = el('input');
  suyo.placeholder = 'el rival';
  const boton = el('button', null, 'Ver');
  const salida = el('div', 'log');

  const row = el('div', 'tags');
  row.append(mio, suyo, boton);
  card.append(row, salida);
  box.append(card);

  boton.onclick = async () => {
    if (!mio.value || !suyo.value) return;
    try {
      const p = await api('/api/prep?campeon=' + encodeURIComponent(mio.value) +
        '&rival=' + encodeURIComponent(suyo.value));
      const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
      const lineas = [
        p.campeon + ' vs ' + p.rival,
        'reps totales (todas las cuentas): ' + p.reps,
        'en esta cuenta: ' + p.propias.ganadas + '/' + p.propias.jugadas,
        ...p.otrasCuentas.map((o) =>
          'en ' + o.cuenta + ': ' + o.ganadas + '/' + o.jugadas + ' — NO se suma, es rendimiento'),
        p.meta === null
          ? 'sin prior de op.gg'
          : 'meta op.gg: ' + pct(p.meta.winRate) + ' sobre ' + p.meta.muestra + ' partidas',
        ...p.estimados.map((e) =>
          'estimado (peso ' + e.peso + '): ' + pct(e.winRate) + ' · propio ' + pct(e.propio)),
        'confianza: ' + p.confianza,
      ];
      salida.textContent = lineas.join('\\n');
    } catch (err) {
      salida.textContent = 'Error: ' + err.message;
    }
  };
}

async function refrescar() {
  try {
    const e = await api('/api/estado');
    renderAcciones(e.acciones);
    renderCuentas(e.cuentas);
    renderKey(e.key);
    document.getElementById('error').textContent = '';
  } catch (err) {
    document.getElementById('error').textContent = 'Error: ' + err.message;
  }
}

const fallar = (err) => {
  document.getElementById('error').textContent = 'Error: ' + err.message;
};

refrescar();
renderSync();
renderPrep();
renderAntes().catch(fallar);
renderPendientes().catch(fallar);
renderMomentos().catch(fallar);
renderGraficos().catch(fallar);
renderCobertura().catch(fallar);
renderLedger().catch(fallar);
// Every 60s, and only the panel — it reads the database and spends no Riot request, so polling
// it cannot eat the rate limit the sync needs.
// The poll refreshes the PANEL and deliberately not the tagging list. Re-rendering that list
// under his hands would reset the buttons mid-ritual and lose his place; when new games arrive
// the panel says so ("Taguear N partidas") and the list redraws after the next tag or sync.
setInterval(() => { if (!document.hidden) refrescar(); }, 60000);
`;

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
  <h1>lol</h1>
  <p class="sub">Local, en tu máquina. Nada de esto sale de acá.</p>
  <div id="error" class="dim"></div>

  <h2>Qué hacer ahora</h2>
  <div id="acciones"></div>

  <h2>Antes de jugar</h2>
  <div id="antes"></div>

  <h2>Sincronizar</h2>
  <div id="sync"></div>

  <h2>Taguear</h2>
  <div id="pendientes"></div>
  <div id="tilt"></div>

  <h2>Lo que salió caro</h2>
  <div id="momentos"></div>

  <h2>En champ select</h2>
  <div id="prep"></div>

  <h2>Curva y mapa</h2>
  <div id="graficos"></div>

  <h2>De qué no puedo hablar todavía</h2>
  <div id="cobertura"></div>

  <h2>Hipótesis registradas</h2>
  <div id="ledger"></div>

  <h2>Cuentas</h2>
  <div id="cuentas"></div>

  <h2>Key</h2>
  <div id="key"></div>
</div>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}

export const escapeForTest = esc;
