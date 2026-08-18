/**
 * The page itself: one HTML document with its CSS and JS inline.
 *
 * No framework and no build step, consistent with ADR-003 and with ADR-014's reasoning for the
 * static page — a panel with buttons over a local JSON API is not a thing that needs a bundler.
 * The document is a SHELL: it ships no data, and everything it shows comes from `/api/*`, so
 * there is exactly one place where each number is produced.
 */

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
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
`;

const SCRIPT = `
const TOKEN = new URLSearchParams(location.search).get('t');
const api = (path) => fetch(path + (path.includes('?') ? '&' : '?') + 't=' + TOKEN)
  .then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    return body;
  });

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

async function renderPendientes() {
  const box = document.getElementById('pendientes');
  box.replaceChildren();
  const { partidas } = await api('/api/pendientes');

  if (partidas.length === 0) {
    const card = el('div', 'card');
    card.append(el('div', 'ok', 'Nada sin taguear.'));
    box.append(card);
    document.getElementById('tilt').replaceChildren();
    return;
  }

  const hint = el('p', 'hint',
    'Más viejas primero, en el orden en que las jugaste. Cada click se guarda en el momento: ' +
    'si cerrás la pestaña a la mitad, lo que ya marcaste queda.');
  box.append(hint);

  for (const p of partidas) {
    const card = el('div', 'card partida');
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
          setTimeout(() => {
            void renderPendientes();
            void refrescar();
          }, 350);
        } catch (err) {
          document.getElementById('error').textContent = 'Error: ' + err.message;
          for (const otro of tags.children) otro.disabled = false;
        }
      };
      tags.append(b);
    }
    card.append(tags);
    box.append(card);
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

refrescar();
renderPendientes().catch((err) => {
  document.getElementById('error').textContent = 'Error: ' + err.message;
});
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
<html lang="es"><head><meta charset="utf-8"><title>lol</title><style>${STYLE}</style></head>
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
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <h1>lol</h1>
  <p class="sub">Local, en tu máquina. Nada de esto sale de acá.</p>
  <div id="error" class="dim"></div>

  <h2>Qué hacer ahora</h2>
  <div id="acciones"></div>

  <h2>Taguear</h2>
  <div id="pendientes"></div>
  <div id="tilt"></div>

  <h2>Cuentas</h2>
  <div id="cuentas"></div>

  <h2>Key</h2>
  <div id="key"></div>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

export const escapeForTest = esc;
