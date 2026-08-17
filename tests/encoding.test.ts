import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Source files are plain text.
 *
 * This exists because nothing else in `verify` looks at bytes. A literal NUL sat inside a
 * string in `matchups.ts` — `join('\0')` where a space was meant — and tsc, Biome and Vitest
 * all passed it, because none of them reads the file as bytes. It surfaced only when git
 * classified the whole source file as BINARY on commit, which would have broken diff and blame
 * on that revision permanently in a public repo (G-018).
 *
 * A control character that is genuinely wanted is written as an escape sequence -- the six
 * characters backslash-u-0-0-0-0 -- so the file itself stays text.
 *
 * This test caught itself first: the sentence above originally carried a raw NUL as its
 * example, which is exactly the mistake being guarded against.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = ['src', 'tests', 'scripts'];

/** Tab, newline and carriage return are the control characters text is allowed to contain. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (path.endsWith('.ts') || path.endsWith('.sql') || path.endsWith('.json')) {
      found.push(path);
    }
  }
  return found;
}

describe('source files are plain text', () => {
  const files = SCANNED.flatMap((dir) => walk(join(ROOT, dir)));

  it('finds files to scan at all, so a broken glob cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('contains no raw control characters beyond tab and newline', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const bytes = readFileSync(file);
      for (const [index, byte] of bytes.entries()) {
        if (byte < 0x20 && !ALLOWED.has(byte)) {
          offenders.push(
            `${file.slice(ROOT.length + 1)} byte 0x${byte.toString(16).padStart(2, '0')} at offset ${index}`,
          );
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no byte-order mark, which git and Node both handle badly', () => {
    const withBom = files.filter((file) => {
      const head = readFileSync(file).subarray(0, 3);
      return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
    });
    expect(withBom).toEqual([]);
  });
});
