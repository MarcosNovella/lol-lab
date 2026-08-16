import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
if (tools.length !== 7) {
  process.stderr.write(`Se esperaban 7 tools, hay ${tools.length}\n`);
  process.exitCode = 1;
}

show('riot_key_status', (await client.callTool({ name: 'riot_key_status', arguments: {} })) as ToolResult);
show('riot_cache_status', (await client.callTool({ name: 'riot_cache_status', arguments: {} })) as ToolResult);

await client.close();
