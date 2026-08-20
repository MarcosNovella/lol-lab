import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { snapshotAll } from '../cli/rank.ts';
import { safeAssetName } from '../riot/assets.ts';
import { createClient } from '../riot/client.ts';
import type { Db } from '../store/db.ts';
import { ASSETS_ROOT, openDb } from '../store/db.ts';
import { backfillTimelines, resolveAccount, syncMatches } from '../sync.ts';
import { renderShell } from './page.ts';
import {
  abrirSesion,
  alcanceDe,
  camino,
  cerrarSesion,
  cobertura,
  cuentaPorDefecto,
  dejarAtras,
  estado,
  filtros,
  firma,
  graficos,
  ledger,
  momentos,
  partida,
  partidas,
  pendientes,
  prep,
  RouteError,
  registrarCuenta,
  resumen,
  runas,
  type SyncEvento,
  sincronizar,
  taguear,
} from './routes.ts';

/**
 * The local UI server.
 *
 * Deliberately `node:http` and nothing else: ADR-003 keeps this repo dependency-free and
 * build-step-free, and a status panel with buttons does not need a framework to exist. Same
 * reasoning ADR-014 used when it rejected Next.js for the static page.
 *
 * NOT to be confused with `src/server.ts`, which is the MCP server and speaks JSON-RPC over
 * stdio. G-001 (never write to stdout) is a property of THAT process, not of this one.
 */

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4477;
/** How many ports to try past the first. A busy 4477 is an ordinary situation — a second window,
 *  a leftover process — and it must not be a dead end behind a shortcut that closes itself. */
export const PORT_TRIES = 9;

/**
 * Per-boot secret, required on every request.
 *
 * Not paranoia and not the "application security" Marcos asked me not to spend effort on: any
 * page you visit can issue requests to 127.0.0.1 from your browser, because that is simply how
 * the web works. Without a token, a random tab could burn the 100-per-2-minutes budget or write
 * tags into the ledger. It is a token check and an Origin check, and that is the whole of it.
 *
 * Regenerated on every boot on purpose: it never needs storing, and a stale bookmark failing
 * closed is the correct outcome.
 */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export type Guard = { ok: true } | { ok: false; status: number; message: string };

/**
 * Decides whether a request may proceed.
 *
 * Two independent checks, because they fail in different situations:
 * - the TOKEN proves the request came from a page we handed the URL to;
 * - the ORIGIN check refuses a cross-site request outright, which catches the case where a token
 *   leaked into somebody's history or a screenshot. A same-origin fetch sends either no Origin
 *   or our own; anything else is another site talking to us.
 */
export function guard(
  request: { method: string; token: string | null; origin: string | null },
  expected: { token: string; origin: string },
): Guard {
  if (request.token !== expected.token) {
    return {
      ok: false,
      status: 403,
      message: 'token inválido — abrí la URL que imprimió `lol ui`',
    };
  }
  const mutating = request.method !== 'GET' && request.method !== 'HEAD';
  if (mutating && request.origin !== null && request.origin !== expected.origin) {
    return { ok: false, status: 403, message: `origen no permitido: ${request.origin}` };
  }
  return { ok: true };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // Nothing here is cacheable: the whole point of the panel is that it reflects the database
    // as it is right now.
    'cache-control': 'no-store',
  });
  response.end(text);
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

/** Reads a JSON body, with a cap: nothing this API accepts is remotely near it, and an
 *  unbounded read is a way to be held open by a request that never ends. */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 64_000) throw new RouteError(413, 'cuerpo demasiado grande');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('no es un objeto');
    return parsed as Record<string, unknown>;
  } catch {
    throw new RouteError(400, 'cuerpo JSON inválido');
  }
}

const str = (body: Record<string, unknown>, field: string): string => {
  const value = body[field];
  if (typeof value !== 'string' || value === '') {
    throw new RouteError(400, `falta '${field}'`);
  }
  return value;
};

/**
 * The account a request with no `cuenta` gets.
 *
 * There is no sensible constant here — 'smurf' was one and it made the main account unreachable.
 * `listAccounts` orders by game name, which would have handed the panel whichever account is
 * alphabetically first: on his cache that is the main, with eleven games, over the smurf with
 * seventy-five. The account he PLAYED last is the one he is coming to the panel about.
 */
const primeraCuenta = (db: Db): string => cuentaPorDefecto(db) ?? '';

/** Narrows the query-string value to the union the route accepts, or null. */
const resultadoDe = (raw: string | null): 'ganadas' | 'perdidas' | null =>
  raw === 'ganadas' || raw === 'perdidas' ? raw : null;

const numOrNull = (body: Record<string, unknown>, field: string): number | null => {
  const value = body[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RouteError(400, `'${field}' tiene que ser un número o null`);
  }
  return value;
};

/**
 * Server-Sent Events: the browser speaks this natively, so a progress stream costs no
 * dependency and no WebSocket handshake (ADR-003).
 */
function sse(response: ServerResponse): (evento: SyncEvento) => void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  return (evento) => {
    response.write(`data: ${JSON.stringify(evento)}\n\n`);
  };
}

export type UiServer = { server: Server; url: string; token: string; port: number };

/**
 * Boots on the first free port from `port` upward.
 *
 * Fixed ports collide, and this is launched from a desktop shortcut whose window closes: an
 * EADDRINUSE there is invisible, so "it just doesn't work" would be the whole error message he
 * ever sees. Any other listen error still rejects — a port being taken is expected, a permission
 * problem is not, and collapsing the two would hide the second.
 */
export async function startUiOnFreePort(
  options: { port?: number; db?: Db; tries?: number } = {},
): Promise<UiServer> {
  const first = options.port ?? DEFAULT_PORT;
  const tries = options.tries ?? PORT_TRIES;
  let last: unknown = null;
  for (let offset = 0; offset <= tries; offset += 1) {
    try {
      return await startUi({ ...options, port: first + offset });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== 'EADDRINUSE') throw error;
      last = error;
    }
  }
  throw last ?? new Error(`no free port between ${first} and ${first + tries}`);
}

export function startUi(options: { port?: number; db?: Db } = {}): Promise<UiServer> {
  const port = options.port ?? DEFAULT_PORT;
  const token = newToken();
  const origin = `http://${HOST}:${port}`;
  const db = options.db ?? openDb();

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        const status = error instanceof RouteError ? error.status : 500;
        json(response, status, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', origin);

    // The shell is served without a token so a bare `localhost:4477` is not a dead end; it
    // carries no data and every API call from it needs the token like anything else.
    if (url.pathname === '/' && url.searchParams.get('t') === null) {
      html(response, renderShell(null));
      return;
    }

    // The browser asks for this on every page load and it has no token, so the guard answered
    // 403 and the console filled with failures that look like the panel is broken.
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }

    // Pictures are served BEFORE the token check, and deliberately: they are Riot's public art,
    // they carry nothing about him, and keeping them token-free means the SVG that embeds the
    // minimap can be memoised across boots instead of being invalidated by every new token.
    // `safeAssetName` plus the fixed set of folders is what stops `/img/champion/../../.env`.
    if (url.pathname.startsWith('/img/')) {
      const [, , kind, file] = url.pathname.split('/');
      if (
        (kind !== 'champion' && kind !== 'item' && kind !== 'map' && kind !== 'rune') ||
        file === undefined ||
        !safeAssetName(file)
      ) {
        json(response, 404, { error: 'no existe esa imagen' });
        return;
      }
      const path = join(ASSETS_ROOT, kind, file);
      if (!existsSync(path)) {
        json(response, 404, { error: 'falta esa imagen — corré `lol assets`' });
        return;
      }
      response.writeHead(200, {
        'content-type': 'image/png',
        // Immutable art on a local server: the browser should not ask twice in a session.
        'cache-control': 'private, max-age=86400',
      });
      response.end(readFileSync(path));
      return;
    }

    const check = guard(
      {
        method: request.method ?? 'GET',
        token: url.searchParams.get('t'),
        origin: request.headers.origin ?? null,
      },
      { token, origin },
    );
    if (!check.ok) {
      json(response, check.status, { error: check.message });
      return;
    }

    // The SCOPE, read once and passed down. The panel used to hardcode `cuenta=smurf` in its
    // own JavaScript and `role: 'MIDDLE', queueId: 420` inside the routes, so the second account
    // and every game outside mid soloq were unreachable from a page that never said so.
    const cuenta = url.searchParams.get('cuenta') ?? primeraCuenta(db);
    const alcance = alcanceDe({
      cuenta,
      rol: url.searchParams.get('rol'),
      cola: url.searchParams.get('cola'),
    });
    const entero = (name: string, fallback: number): number => {
      const raw = url.searchParams.get(name);
      const value = raw === null ? fallback : Number(raw);
      return Number.isInteger(value) && value > 0 ? value : fallback;
    };

    if (url.pathname === '/') {
      html(response, renderShell(token));
      return;
    }
    if (url.pathname === '/api/estado') {
      json(response, 200, estado(db));
      return;
    }
    if (url.pathname === '/api/pendientes') {
      json(response, 200, pendientes(db, cuenta));
      return;
    }
    if (url.pathname === '/api/sesion/abrir' && request.method === 'POST') {
      json(response, 200, abrirSesion(db, cuenta));
      return;
    }
    if (url.pathname === '/api/tag' && request.method === 'POST') {
      const body = await readJson(request);
      // The write happens before the response is written, so a 200 means the tag is on disk.
      json(
        response,
        200,
        taguear(db, {
          cuenta,
          matchId: str(body, 'matchId'),
          tag: str(body, 'tag'),
          sesion: numOrNull(body, 'sesion'),
        }),
      );
      return;
    }
    if (url.pathname === '/api/cuenta' && request.method === 'POST') {
      const body = await readJson(request);
      const label = body['label'];
      json(
        response,
        200,
        await registrarCuenta(
          {
            riotId: str(body, 'riotId'),
            label: typeof label === 'string' && label !== '' ? label : null,
          },
          // The client is built per call, exactly like the sync's: ADR-005 re-reads the key on
          // every request, so a key pasted after boot works without a restart.
          (gameName, tagLine, accountLabel) =>
            resolveAccount(createClient(), db, gameName, tagLine, accountLabel),
        ),
      );
      return;
    }
    if (url.pathname === '/api/dejar-atras' && request.method === 'POST') {
      json(response, 200, dejarAtras(db));
      return;
    }
    if (url.pathname === '/api/sesion/cerrar' && request.method === 'POST') {
      const body = await readJson(request);
      const sesion = numOrNull(body, 'sesion');
      if (sesion === null) throw new RouteError(400, "falta 'sesion'");
      json(response, 200, cerrarSesion(db, { sesion, tilt: numOrNull(body, 'tilt') }));
      return;
    }
    if (url.pathname === '/api/momentos') {
      json(response, 200, momentos(db, alcance, entero('limite', 5)));
      return;
    }
    if (url.pathname === '/api/graficos') {
      json(response, 200, graficos(db, alcance));
      return;
    }
    if (url.pathname === '/api/filtros') {
      json(response, 200, filtros(db, cuenta));
      return;
    }
    if (url.pathname === '/api/firma') {
      json(
        response,
        200,
        firma(db, alcance, {
          campeon: url.searchParams.get('campeon'),
          rival: url.searchParams.get('rival'),
        }),
      );
      return;
    }
    if (url.pathname === '/api/camino') {
      json(response, 200, camino(db, alcance, url.searchParams.get('objetivo') ?? 'DIAMOND'));
      return;
    }
    if (url.pathname === '/api/runas') {
      json(response, 200, runas(db, alcance));
      return;
    }
    if (url.pathname === '/api/resumen') {
      json(response, 200, resumen(db, alcance, { forma: entero('forma', 20) }));
      return;
    }
    if (url.pathname === '/api/partidas') {
      json(
        response,
        200,
        partidas(db, alcance, {
          campeon: url.searchParams.get('campeon'),
          rival: url.searchParams.get('rival'),
          resultado: resultadoDe(url.searchParams.get('resultado')),
          tag: url.searchParams.get('tag'),
          limite: entero('limite', 25),
        }),
      );
      return;
    }
    if (url.pathname === '/api/partida') {
      const id = url.searchParams.get('id');
      if (id === null) throw new RouteError(400, "falta 'id'");
      json(response, 200, partida(db, cuenta, id));
      return;
    }
    if (url.pathname === '/api/cobertura') {
      json(response, 200, cobertura(db, cuenta));
      return;
    }
    if (url.pathname === '/api/ledger') {
      json(response, 200, ledger(db));
      return;
    }
    if (url.pathname === '/api/prep') {
      const campeon = url.searchParams.get('campeon');
      const rival = url.searchParams.get('rival');
      if (campeon === null || rival === null) {
        throw new RouteError(400, 'faltan campeon y rival');
      }
      json(response, 200, prep(db, cuenta, campeon, rival));
      return;
    }
    if (url.pathname === '/api/sync') {
      const emit = sse(response);
      await sincronizar(db, cuenta, emit, {
        sync: async (puuid, onProgress) => {
          const client = createClient();
          return syncMatches(client, db, {
            puuid,
            max: 20,
            // Without timelines there are no expensive moments, which is most of what the page
            // has to show afterwards.
            withTimeline: true,
            onProgress,
          });
        },
        // The second phase of the button: timelines for games ALREADY cached. Capped like the
        // first, so one click can never turn into a seven-minute wait he did not ask for; it
        // is idempotent, so the next click carries on where this one stopped.
        reparar: async (puuid, onProgress) => {
          const client = createClient();
          const result = await backfillTimelines(client, db, { puuid, max: 20, onProgress });
          return { fetched: result.fetched, errors: result.errors };
        },
        rango: async () => {
          await snapshotAll(db);
        },
      });
      response.end();
      return;
    }
    json(response, 404, { error: `no existe ${url.pathname}` });
  }

  return new Promise<UiServer>((resolve, reject) => {
    const onListenError = (error: unknown): void => reject(error);
    server.once('error', onListenError);
    // 127.0.0.1, never 0.0.0.0: this process holds the Riot key, and nothing on the network has
    // any business reaching it.
    server.listen(port, HOST, () => {
      // Stop treating errors as boot failures: from here on a socket error is a live-server
      // problem, and leaving this attached would try to reject an already-settled promise.
      server.off('error', onListenError);
      resolve({ server, url: `${origin}/?t=${token}`, token, port });
    });
  });
}
