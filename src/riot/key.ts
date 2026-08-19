import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PLATFORM, isPlatform, type Platform } from './routing.ts';

/**
 * The key lives in `.env` and is re-read on every request (ADR-005).
 *
 * Development keys expire every 24 hours. Caching the key at boot would mean Marcos has to
 * restart Claude Code each morning; re-reading means he pastes a fresh value into the file
 * and the very next call works.
 *
 * G-002: the key VALUE never leaves this module. Nothing here logs it, and callers get
 * either the key itself (to build a request) or a redacted description (to show a human).
 */

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_PATH = join(PROJECT_ROOT, '.env');

export type KeyKind = 'development' | 'personal-or-production' | 'unknown';

export type KeyState = {
  present: boolean;
  /** `RGAPI-xxxx…xxxx` — first and last 4 chars only, never the whole value. */
  masked: string | null;
  kind: KeyKind;
  /** mtime of `.env`; for a dev key this is effectively "when the 24h clock started". */
  updatedAt: Date | null;
  /** Only meaningful for development keys, which Riot expires 24h after issue. */
  likelyExpired: boolean;
  hoursSinceUpdate: number | null;
  platform: Platform;
  envPath: string;
  problem: string | null;
};

function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (name !== '') out.set(name, value);
  }
  return out;
}

function readEnvFile(): { vars: Map<string, string>; mtime: Date | null } {
  try {
    const vars = parseEnv(readFileSync(ENV_PATH, 'utf8'));
    return { vars, mtime: statSync(ENV_PATH).mtime };
  } catch {
    return { vars: new Map(), mtime: null };
  }
}

function classify(key: string): KeyKind {
  // Riot issues development keys with an `RGAPI-` prefix. Personal and production keys use
  // the same prefix, so the shape alone cannot tell them apart — that is what `kind` being
  // 'personal-or-production' means: we know it is a valid-looking key, not which tier.
  if (!key.startsWith('RGAPI-')) return 'unknown';
  return 'development';
}

function mask(key: string): string {
  if (key.length <= 12) return 'RGAPI-****';
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}

/** Reads the current key. Returns null when `.env` is missing or `RIOT_API_KEY` is blank. */
export function readKey(): string | null {
  const fromProcess = process.env['RIOT_API_KEY']?.trim();
  if (fromProcess) return fromProcess;
  const value = readEnvFile().vars.get('RIOT_API_KEY')?.trim();
  return value ? value : null;
}

export function readPlatform(): Platform {
  const raw = (process.env['RIOT_PLATFORM'] ?? readEnvFile().vars.get('RIOT_PLATFORM') ?? '')
    .trim()
    .toLowerCase();
  return isPlatform(raw) ? raw : DEFAULT_PLATFORM;
}

/**
 * Everything a human needs to diagnose a key problem, and nothing that leaks it.
 */
export function keyState(now: Date = new Date()): KeyState {
  const { mtime } = readEnvFile();
  const key = readKey();
  const platform = readPlatform();

  if (!key) {
    return {
      present: false,
      masked: null,
      kind: 'unknown',
      updatedAt: mtime,
      likelyExpired: false,
      hoursSinceUpdate: null,
      platform,
      envPath: ENV_PATH,
      problem:
        `No hay key. Sacá una en https://developer.riotgames.com (login con tu cuenta de ` +
        `Riot, botón "Regenerate API Key") y pegala en ${ENV_PATH} como RIOT_API_KEY=RGAPI-...`,
    };
  }

  const hours = mtime === null ? null : (now.getTime() - mtime.getTime()) / 3_600_000;
  const kind = classify(key);
  const likelyExpired = kind === 'development' && hours !== null && hours >= 24;

  return {
    present: true,
    masked: mask(key),
    kind,
    updatedAt: mtime,
    likelyExpired,
    hoursSinceUpdate: hours,
    platform,
    envPath: ENV_PATH,
    problem: likelyExpired
      ? `La key se pegó hace ${Math.floor(hours ?? 0)} h. Las keys de desarrollo caducan a ` +
        `las 24 h: si las llamadas fallan con 401/403, regenerala y pegá la nueva en ${ENV_PATH}. ` +
        `No hace falta reiniciar nada.`
      : null,
  };
}

export class KeyError extends Error {}

/**
 * Escribe una key nueva en `.env`, preservando todo lo demás del archivo.
 *
 * Existe porque la key de desarrollo vence cada 24 h y pegarla era el último paso que lo
 * obligaba a salir del panel. También cierra el incidente de S8b: la pegó a mano en
 * `.env.example`, que ESTÁ TRACKEADO y va a un repo público. Un solo destino, elegido por el
 * programa, es más seguro que un archivo elegido por una persona apurada a las tres de la mañana.
 *
 * Tres cosas que no hace, y cada una es deliberada:
 * - No devuelve el valor ni lo loguea (G-002). El que llama recibe `keyState()`, que ya es una
 *   descripción sin el valor adentro.
 * - No acepta cualquier cosa: sin el prefijo `RGAPI-` no escribe. Pegar media key y que el
 *   archivo quede pisado es peor que no escribir nada.
 * - No normaliza los finales de línea: si el archivo venía CRLF se reescribe CRLF. Convertir un
 *   archivo entero al escribir una línea es exactamente G-010.
 *
 * `path` existe con la misma forma que en `openDb`, y por la misma razón: sin él un test de esta
 * función pisa el `.env` REAL de su máquina cada vez que corre `pnpm verify`, y le borra la key
 * buena con una de mentira. Producción nunca lo pasa.
 */
export function writeKey(value: string, path: string = ENV_PATH): void {
  const key = value.trim();
  if (key === '') throw new KeyError('la key vino vacía');
  if (!key.startsWith('RGAPI-')) {
    throw new KeyError('eso no parece una key de Riot: tienen que empezar con RGAPI-');
  }
  if (/\s/.test(key)) throw new KeyError('la key tiene espacios adentro: copiala de nuevo entera');

  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    /* no hay .env todavía: se crea */
  }
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const lines = existing === '' ? [] : existing.split(/\r?\n/);

  let written = false;
  const updated = lines.map((line) => {
    if (/^\s*RIOT_API_KEY\s*=/.test(line)) {
      written = true;
      return `RIOT_API_KEY=${key}`;
    }
    return line;
  });
  if (!written) updated.push(`RIOT_API_KEY=${key}`);

  // El archivo termina en newline, como lo dejaría un editor.
  const body = updated.join(eol).replace(/(\r?\n)+$/, '');
  writeFileSync(path, `${body}${eol}`, 'utf8');
}

/** Strips the key out of any string before it can reach a log or a tool response (G-002). */
export function redact(text: string): string {
  return text.replace(/RGAPI-[A-Za-z0-9-]+/g, 'RGAPI-«oculta»');
}

export const ENV_FILE_PATH = ENV_PATH;
