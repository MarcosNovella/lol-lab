import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DEFAULT_DB_PATH } from '../store/db.ts';
import { DEFAULT_PORT, startUiOnFreePort } from '../ui/server.ts';
import { CliError, out } from './shared.ts';

/**
 * `lol ui` — the panel, in the browser.
 *
 * One command per sitting, and after it he does not go back to the terminal: the ritual, the
 * sync and the reading all happen by click. The process has to exist because a `file://` page
 * cannot sync, cannot reach the Riot API and cannot write to SQLite — which is exactly why the
 * static page from ADR-014 could only ever show, never do.
 *
 * It stays in the foreground on purpose. A background daemon holding the Riot key, with no
 * window to close, is a thing you forget is running; Ctrl-C here means it is off.
 */

/**
 * Escapes a URL for `cmd`'s parser.
 *
 * `start` is a cmd BUILTIN, so the shell reads the line before `start` ever sees it and `&`
 * separates commands. Caret is cmd's escape character. Exported because it is the one piece of
 * this that can be tested from Linux, and it is the piece that broke.
 */
export function escapeForCmd(url: string): string {
  return url.replace(/[&|^<>]/g, (char) => `^${char}`);
}

function openBrowser(url: string): void {
  // Best effort by platform, and a failure is genuinely not an error: the URL is already on
  // screen and opening a browser is a convenience, not the job.
  if (process.platform === 'win32') {
    // WHY THIS SHAPE, and it is worth reading because the obvious version is what broke.
    //
    // Passing `"${url}"` as an argv entry does NOT quote it: Node escapes the quotes itself when
    // it builds the Windows command line, so cmd received \"http://...\" and `start` went looking
    // for a FILE by that literal name. The fix for a hypothetical `&` broke the actual launch.
    //
    // `windowsVerbatimArguments` turns Node's escaping off, so the line below is passed to cmd
    // exactly as written; the URL is escaped for cmd's own parser instead, which is the parser
    // that actually matters. The empty `""` is `start`'s title argument — without it, `start`
    // treats the first quoted token as the window title and opens nothing.
    const child = spawn('cmd.exe', ['/c', 'start', '""', escapeForCmd(url)], {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    });
    child.on('error', () => {});
    child.unref();
    return;
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
  // `spawn` reports a missing binary ASYNCHRONOUSLY, through an 'error' event — a try/catch
  // around the call looks like it handles that and handles nothing. Without this listener the
  // event is unhandled and takes the whole process down, so a machine with no `xdg-open` could
  // not run the UI at all (G-021).
  child.on('error', () => {});
  child.unref();
}

/**
 * Says what is wrong before the browser opens on a page that cannot work.
 *
 * Every line here is defensive about a machine I cannot test from: this is developed on Linux
 * and run on Windows. It WARNS and does not block — Node 22 runs the whole suite green despite
 * `engines` asking for 24, so refusing to start on a version number would be refusing over a
 * number rather than over a capability.
 */
function preflight(): void {
  const major = Number(process.versions.node.split('.')[0] ?? 0);
  if (major < 22) {
    out(`  aviso: Node ${process.versions.node}. Hace falta 22 o superior por node:sqlite y por`);
    out('  el borrado de tipos sin compilador; abajo de eso esto no arranca.');
  }

  // Not an error and not a warning: a first run has no cache, and saying "no existe la base"
  // as a problem would teach him that a normal state is a broken one.
  if (!existsSync(DEFAULT_DB_PATH)) {
    out('  (todavía no hay caché — la primera sincronización la crea)');
  }
}

export async function run(argv: string[]): Promise<void> {
  const portArg = argv[0];
  const port = portArg === undefined ? DEFAULT_PORT : Number(portArg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`puerto inválido '${portArg}'`);
  }

  preflight();

  let ui: Awaited<ReturnType<typeof startUiOnFreePort>>;
  try {
    ui = await startUiOnFreePort({ port });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }

  out(`lol ui en ${ui.url}`);
  if (ui.port !== port) out(`  (el ${port} estaba ocupado, usé el ${ui.port})`);
  out();
  // Said out loud because opening the browser is the one step that depends on the machine, and
  // when it failed the panel looked broken when it was already running and reachable.
  out('  Si el navegador no se abre solo, copiá esa URL y pegala vos: el panel ya está andando.');
  out('  El token cambia en cada arranque, así que guardar el favorito no sirve de nada.');
  out('  Ctrl-C para apagarlo.');
  openBrowser(ui.url);

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      ui.server.close(() => resolve());
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  out('apagado');
}

export const SUMMARY =
  'abre el panel local en el navegador: taguear, sincronizar y leer, por click';
export const USAGE = 'lol ui [puerto]';
