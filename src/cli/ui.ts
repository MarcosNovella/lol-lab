import { spawn } from 'node:child_process';
import { DEFAULT_PORT, startUi } from '../ui/server.ts';
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

function openBrowser(url: string): void {
  // Best effort by platform, and a failure is genuinely not an error: the URL is already on
  // screen and opening a browser is a convenience, not the job.
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  // `spawn` reports a missing binary ASYNCHRONOUSLY, through an 'error' event — a try/catch
  // around the call looks like it handles that and handles nothing. Without this listener the
  // event is unhandled and takes the whole process down, so a machine with no `xdg-open` could
  // not run the UI at all (G-021).
  child.on('error', () => {});
  child.unref();
}

export async function run(argv: string[]): Promise<void> {
  const portArg = argv[0];
  const port = portArg === undefined ? DEFAULT_PORT : Number(portArg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`puerto inválido '${portArg}'`);
  }

  let ui: Awaited<ReturnType<typeof startUi>>;
  try {
    ui = await startUi({ port });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new CliError(
      why.includes('EADDRINUSE')
        ? `el puerto ${port} está ocupado — probá 'lol ui ${port + 1}', o cerrá la otra ventana`
        : why,
    );
  }

  out(`lol ui en ${ui.url}`);
  out();
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
