import * as cerrar from './cli/cerrar.ts';
import * as cobertura from './cli/cobertura.ts';
import * as growth from './cli/growth.ts';
import * as hip from './cli/hip.ts';
import * as page from './cli/page.ts';
import * as prep from './cli/prep.ts';
import * as rank from './cli/rank.ts';
import * as report from './cli/report.ts';
import { CliError, closeInput, out } from './cli/shared.ts';

/**
 * `lol` — one entry point for the rituals.
 *
 * Before this every ritual was `node scripts/report.ts smurf 5 mid`: undiscoverable, with the
 * argument order living only in a comment at the top of the file. The daily ritual with the most
 * friction is the one that does not get done, and ADR-007 spends thirty seconds a session that
 * only pay off if they are actually spent.
 *
 * This is a front-end, not a layer: every command below reads from `src/analysis/*`, which stays
 * pure and I/O-free, exactly as the MCP server does (ADR-006). Two front-ends over one library —
 * the server for conversation, this for the rituals, because a forty-fight report does not fit
 * in an MCP response and a nightly sync is not a chat turn.
 *
 * `scripts/` keeps what is genuinely not a ritual: `smoke.ts` and `call.ts` (development),
 * `register-hypotheses.ts` (a deliberate, dated, one-off act) and `export-matchup-record.ts`.
 */

type Command = {
  summary: string;
  usage: string;
  run: (argv: string[]) => void | Promise<void>;
};

const COMMANDS: Record<string, Command> = {
  cerrar: { summary: cerrar.SUMMARY, usage: cerrar.USAGE, run: cerrar.run },
  report: { summary: report.SUMMARY, usage: report.USAGE, run: report.run },
  prep: { summary: prep.SUMMARY, usage: prep.USAGE, run: prep.run },
  cobertura: { summary: cobertura.SUMMARY, usage: cobertura.USAGE, run: cobertura.run },
  growth: { summary: growth.SUMMARY, usage: growth.USAGE, run: growth.run },
  page: { summary: page.SUMMARY, usage: page.USAGE, run: page.run },
  hip: { summary: hip.SUMMARY, usage: hip.USAGE, run: hip.run },
  rank: { summary: rank.SUMMARY, usage: rank.USAGE, run: rank.run },
};

function help(): void {
  out('lol — el motor, desde la terminal');
  out();
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, command] of Object.entries(COMMANDS)) {
    out(`  ${name.padEnd(width)}  ${command.summary}`);
  }
  out();
  out('Uso:');
  for (const command of Object.values(COMMANDS)) out(`  ${command.usage}`);
  out();
  out('El ritual es `lol cerrar`. Todo lo demás es para cuando querés mirar algo puntual.');
}

const [, , name, ...rest] = process.argv;

if (name === undefined || name === '-h' || name === '--help' || name === 'help') {
  help();
} else {
  const command = COMMANDS[name];
  if (command === undefined) {
    out(`No existe el comando '${name}'.`);
    out();
    help();
    process.exit(1);
  } else {
    try {
      await command.run(rest);
      closeInput();
    } catch (error) {
      closeInput();
      // A CliError is a message for him — a missing account, a bad argument. Anything else is a
      // defect and keeps its stack, because swallowing it is how a wrong number gets reported as
      // a working one.
      if (error instanceof CliError) {
        out(`Error: ${error.message}`);
        process.exit(1);
      }
      throw error;
    }
  }
}
