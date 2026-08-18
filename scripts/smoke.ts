import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Boots the server the same way Claude Code does and exercises the tools that work without
 * a key. `pnpm verify` proves the units; this proves the wiring — that the process starts,
 * speaks JSON-RPC over stdio, registers every tool, and fails readably when the key is
 * missing. Run it after touching server.ts.
 *
 * Writes to stdout on purpose: this is a CLI, not the server (G-001 applies to src/server.ts).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type TextContent = { type: string; text?: string };
type ToolResult = { content?: TextContent[]; isError?: boolean };

function show(title: string, result: ToolResult): void {
  const body = result.content?.map((c) => c.text ?? '').join('\n') ?? '(sin contenido)';
  process.stdout.write(`\n--- ${title} ---\n${body}\n`);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['--disable-warning=ExperimentalWarning', 'src/server.ts'],
  cwd: ROOT,
});
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(transport);

const { tools } = await client.listTools();
process.stdout.write(`tools registradas: ${tools.length}\n`);
for (const tool of tools) {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
  const params = Object.keys(schema?.properties ?? {});
  process.stdout.write(`  ${tool.name.padEnd(22)} (${params.join(', ') || 'sin args'})\n`);
}
/**
 * The tools this server is supposed to expose, by NAME rather than by count.
 *
 * It used to assert `length !== 7` and had been silently wrong since `riot_backfill_timelines`
 * was added: a count tells you the number changed, never which one went missing, and it goes
 * stale the moment anyone adds a tool without touching this line. Naming them means a tool
 * that disappears is reported by name, and a new one has to be declared here on purpose.
 */
const EXPECTED = [
  'riot_key_status',
  'riot_resolve_account',
  'riot_sync',
  'riot_backfill_timelines',
  'riot_matches',
  'riot_benchmark',
  'riot_match_detail',
  'riot_cache_status',
  'lol_prep',
  'lol_coverage',
  'lol_hypotheses',
  'lol_tags',
  'lol_tag',
  'lol_rank',
];

const found = new Set(tools.map((t) => t.name));
const missing = EXPECTED.filter((name) => !found.has(name));
const extra = [...found].filter((name) => !EXPECTED.includes(name));
if (missing.length > 0) {
  process.stderr.write(`Faltan tools: ${missing.join(', ')}\n`);
  process.exitCode = 1;
}
if (extra.length > 0) {
  process.stderr.write(`Tools sin declarar en el smoke: ${extra.join(', ')}\n`);
  process.exitCode = 1;
}

show(
  'riot_key_status',
  (await client.callTool({ name: 'riot_key_status', arguments: {} })) as ToolResult,
);
show(
  'riot_cache_status',
  (await client.callTool({ name: 'riot_cache_status', arguments: {} })) as ToolResult,
);

await client.close();
