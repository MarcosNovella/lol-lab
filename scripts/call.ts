import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Calls one tool on the real server, over the real stdio transport.
 *
 *   pnpm call riot_key_status
 *   pnpm call riot_resolve_account gameName=legendoftorcuato tagLine=las label=smurf
 *   pnpm call riot_sync account=smurf queue=soloq max=100
 *
 * Values are parsed as JSON when they look like it (numbers, true/false), otherwise kept as
 * strings. Useful when the server is registered but the current Claude session predates it,
 * and as a way to script a backfill outside a conversation.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const [toolName, ...pairs] = process.argv.slice(2);
if (toolName === undefined) {
  process.stderr.write('uso: pnpm call <tool> [clave=valor ...]\n');
  process.exit(1);
}

const args: Record<string, unknown> = {};
for (const pair of pairs) {
  const eq = pair.indexOf('=');
  if (eq === -1) continue;
  const key = pair.slice(0, eq);
  const raw = pair.slice(eq + 1);
  if (raw === 'true') args[key] = true;
  else if (raw === 'false') args[key] = false;
  else if (raw !== '' && Number.isFinite(Number(raw))) args[key] = Number(raw);
  else args[key] = raw;
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['--disable-warning=ExperimentalWarning', 'src/server.ts'],
  cwd: ROOT,
});
const client = new Client({ name: 'cli', version: '1' });
await client.connect(transport);

type TextContent = { type: string; text?: string };
const result = (await client.callTool({ name: toolName, arguments: args })) as {
  content?: TextContent[];
  isError?: boolean;
};

process.stdout.write(`${result.content?.map((c) => c.text ?? '').join('\n') ?? ''}\n`);
if (result.isError === true) process.exitCode = 1;

await client.close();
