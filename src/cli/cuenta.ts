import { createClient } from '../riot/client.ts';
import { openDb } from '../store/db.ts';
import { listAccounts } from '../store/matches.ts';
import { resolveAccount } from '../sync.ts';
import { CliError, out } from './shared.ts';

/**
 * `lol cuenta <Nombre#TAG> [etiqueta]` — resolves a Riot ID and stores it.
 *
 * The first thing anyone has to do, and until now the ONLY way to do it was the MCP tool
 * `riot_resolve_account` — which means the first step of the workflow could only be taken by
 * talking to Claude. A fresh clone that ran `pnpm lol ui`, which the README calls THE ritual,
 * got a panel answering 404 `no conozco la cuenta 'smurf'` on five of its routes, with no way
 * forward anywhere on the page.
 *
 * The label is what everything else calls the account afterwards (`lol report smurf`), so it is
 * asked for here rather than derived: `smurf` and `main` are his words for these accounts and
 * no part of the Riot API knows them.
 */

export async function run(argv: string[]): Promise<void> {
  const [riotId, label] = argv;
  if (riotId === undefined) {
    throw new CliError(
      'uso: lol cuenta <Nombre#TAG> [etiqueta]   (ej: lol cuenta LaMarso#LAS main)',
    );
  }

  // Split on the LAST '#': a game name may contain one, a tag line may not.
  const cut = riotId.lastIndexOf('#');
  if (cut <= 0 || cut === riotId.length - 1) {
    throw new CliError(
      `'${riotId}' no tiene forma de Riot ID. Va Nombre#TAG, como LegendofTorcuato#LAS ` +
        '(el TAG está al lado de tu nombre en el cliente, no es la región).',
    );
  }
  const gameName = riotId.slice(0, cut);
  const tagLine = riotId.slice(cut + 1);

  const db = openDb();
  try {
    const client = createClient();
    const account = await resolveAccount(
      client,
      db,
      gameName,
      tagLine,
      ...(label !== undefined ? ([label] as const) : ([] as const)),
    );

    out(
      `${account.gameName}#${account.tagLine} — guardada como '${account.label ?? account.gameName}'`,
    );
    out(`  nivel ${account.summonerLevel ?? '?'} · ${account.platform}`);
    if (account.ranked.length === 0) {
      // Unranked and "the ranked endpoint failed" look identical from here, so neither is
      // asserted: saying "sos unranked" to someone who is Platinum is worse than saying nothing.
      out('  sin datos de ranked (o la cuenta no tiene rango todavía)');
    }
    for (const r of account.ranked) {
      out(`  ${r.queue}: ${r.tier} ${r.division} ${r.lp} LP (${r.wins}W-${r.losses}L)`);
    }
    out('');
    out('Ahora bajá las partidas: `lol ui` y el botón de sincronizar, o `lol cerrar`.');

    const others = listAccounts(db).filter((a) => a.puuid !== account.puuid);
    if (others.length > 0) {
      out(
        `Cuentas en la caché: ${listAccounts(db)
          .map((a) => a.label ?? a.gameName)
          .join(', ')}`,
      );
    }
  } finally {
    db.close();
  }
}

export const SUMMARY = 'resuelve un Riot ID y lo guarda: el primer paso de todo';
export const USAGE = 'lol cuenta <Nombre#TAG> [etiqueta]';
