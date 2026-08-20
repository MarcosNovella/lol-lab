import type { Interface } from 'node:readline';
import { createInterface } from 'node:readline';
import type { Db } from '../store/db.ts';
import type { AccountRecord } from '../store/matches.ts';
import { findAccount, listAccounts } from '../store/matches.ts';

/**
 * Bits every command needs.
 *
 * G-001 does NOT apply here: the ban on stdout is a property of `src/server.ts`, whose stdout is
 * the JSON-RPC channel. This is a terminal program and stdout is its output.
 */

export function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export class CliError extends Error {}

/** Resolves an account by label, Riot ID or game name, failing with the list of real ones. */
export function account(db: Db, needle: string): AccountRecord {
  const found = findAccount(db, needle);
  if (found !== null) return found;
  const known = listAccounts(db)
    .map((a) => a.label ?? a.gameName)
    .join(', ');
  // In Spanish, like the rest of the CLI, and pointing at a command that exists here: it used
  // to send him to `riot_resolve_account`, which is an MCP tool and cannot be run from a
  // terminal at all — the error told him to leave the program to fix the program.
  throw new CliError(
    known === ''
      ? `no conozco la cuenta '${needle}', y de hecho no hay ninguna en la caché. ` +
          'Empezá por `lol cuenta <Nombre#TAG> [etiqueta]`.'
      : `no conozco la cuenta '${needle}'. Las que hay: ${known}.`,
  );
}

export function labelOf(record: AccountRecord): string {
  return record.label ?? record.gameName;
}

/**
 * Reads ONE keystroke from a list of valid ones, case-insensitively.
 *
 * Raw mode when stdin is a terminal, so the ritual really is one tap per game; a plain line read
 * otherwise, so the command still works piped or under a test. Ctrl-C ends the process rather
 * than being swallowed — a prompt you cannot escape is a prompt that stops being answered
 * honestly.
 */
export async function readKey(valid: string[]): Promise<string> {
  const wanted = new Set(valid.map((k) => k.toLowerCase()));

  if (process.stdin.isTTY) {
    return new Promise<string>((resolve) => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      const onData = (chunk: Buffer): void => {
        const key = chunk.toString('utf8');
        // Escape, never the raw byte: a control character in source is invisible to tsc,
        // Biome and Vitest alike, and this one had already collapsed to an empty string, so the
        // Ctrl-C branch could never fire (G-018).
        if (key === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        const lower = key.toLowerCase();
        if (!wanted.has(lower)) return; // ignore anything that is not an answer
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stdout.write(`${lower}\n`);
        resolve(lower);
      };
      process.stdin.on('data', onData);
    });
  }

  for (;;) {
    const { value, done } = await lines().next();
    if (done === true || value === undefined) {
      throw new CliError('stdin ended before an answer was given');
    }
    const first = value.trim().toLowerCase().slice(0, 1);
    if (wanted.has(first)) {
      // Echo it, exactly as the raw-mode branch does. Without this a piped run prints four
      // prompts on one unreadable line, and the transcript of a session is worth having.
      process.stdout.write(`${first}\n`);
      return first;
    }
  }
}

/**
 * ONE line iterator over stdin, shared by every prompt.
 *
 * A `readline` interface per question does not work: the first one buffers everything stdin has
 * and the second sees EOF, so a four-game session answered from a pipe read one tag and then
 * died. It looked like a stdin bug and was a lifetime bug.
 */
let sharedInput: { rl: Interface; iterator: AsyncIterator<string> } | null = null;

function lines(): AsyncIterator<string> {
  if (sharedInput === null) {
    const rl = createInterface({ input: process.stdin });
    sharedInput = { rl, iterator: rl[Symbol.asyncIterator]() };
  }
  return sharedInput.iterator;
}

/** Releases stdin so the process can exit. Safe to call when nothing ever read from it. */
export function closeInput(): void {
  sharedInput?.rl.close();
  sharedInput = null;
}

/** dd/mm HH:MM in local time, asked of Intl by part rather than sliced out of a formatted
 *  string — es-AR renders 12-hour with a " p. m." suffix, so a slice reads 18:05 as 06:05
 *  (G-006). */
export function localStamp(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '??';
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}

/** Whole minutes, or a dash when the quantity was never measured (G-005). */
export function minutes(ms: number): string {
  return Number.isFinite(ms) ? `${Math.round(ms / 60_000)}′` : '—';
}
