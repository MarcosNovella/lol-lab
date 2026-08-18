import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Db } from '../store/db.ts';
import { openDb } from '../store/db.ts';
import { renderShell } from './page.ts';
import { estado } from './routes.ts';

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

export type UiServer = { server: Server; url: string; token: string; port: number };

export function startUi(options: { port?: number; db?: Db } = {}): Promise<UiServer> {
  const port = options.port ?? DEFAULT_PORT;
  const token = newToken();
  const origin = `http://${HOST}:${port}`;
  const db = options.db ?? openDb();

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', origin);

    // The shell is served without a token so a bare `localhost:4477` is not a dead end; it
    // carries no data and every API call from it needs the token like anything else.
    if (url.pathname === '/' && url.searchParams.get('t') === null) {
      html(response, renderShell(null));
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

    try {
      if (url.pathname === '/') {
        html(response, renderShell(token));
        return;
      }
      if (url.pathname === '/api/estado') {
        json(response, 200, estado(db));
        return;
      }
      json(response, 404, { error: `no existe ${url.pathname}` });
    } catch (error) {
      // The message is shown in the page, so it goes through nothing that could carry a key:
      // every error surface in this project is subject to G-002.
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return new Promise<UiServer>((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1, never 0.0.0.0: this process holds the Riot key, and nothing on the network has
    // any business reaching it.
    server.listen(port, HOST, () => {
      resolve({ server, url: `${origin}/?t=${token}`, token, port });
    });
  });
}
