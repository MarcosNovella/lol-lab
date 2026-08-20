import type { MatchDto, ParticipantDto } from '../riot/types.ts';
import type { RuneCatalog } from '../store/items.ts';

/**
 * The runes, which have been sitting in the cache since the first sync with nothing reading them.
 *
 * That is ADR-004 paying out as written: the full match JSON is stored so a dimension nobody
 * thought to flatten can be derived later without re-downloading eighty-six games against a
 * 100-per-two-minutes limit. This costs ZERO Riot requests — the only download is one Data
 * Dragon catalogue per patch, on a different host with no key and no limiter (ADR-020).
 *
 * Why the keystone and not the whole page: it is the one rune choice that is a DECISION about
 * how to play the matchup rather than a stat allocation, it is legible to a human ("llevé
 * Electrocute contra un Zed"), and it is known BEFORE the game starts, which is what makes it
 * usable as a stratum at all (G-008). The minor runes are in the payload and deliberately not
 * read: six more categorical dimensions over eighty-six games is a machine for manufacturing
 * findings, and G-011 would demand a sweep of every one of them.
 */

export type Keystone = {
  runeId: number;
  /** Riot's internal name (`Electrocute`). Stable across locales, which `name` is not. */
  key: string;
  name: string;
  treeId: number;
  treeName: string;
  icon: string;
};

/**
 * The keystone a participant ran, or null when the payload carries no perks.
 *
 * `slot === 0` is the definition of a keystone rather than a hardcoded list of ids: slot 0 of a
 * tree holds its keystones and nothing else, and a list of ids goes stale every preseason. A
 * perk the catalogue does not know is reported as unknown rather than guessed at — the patch's
 * own catalogue is the only authority on what a rune id meant that patch.
 */
export function keystoneOf(participant: ParticipantDto, catalog: RuneCatalog): Keystone | null {
  const primary = participant.perks?.styles?.find((s) => s.description === 'primaryStyle');
  const first = primary?.selections?.[0]?.perk;
  if (first === undefined) return null;
  const rune = catalog.get(first);
  if (rune === undefined || rune.slot !== 0) return null;
  return {
    runeId: first,
    key: rune.key,
    name: rune.name,
    treeId: rune.treeId,
    treeName: rune.treeName,
    icon: rune.icon,
  };
}

/** The secondary tree's id, which is a choice too and costs nothing to carry. */
export function secondaryTreeOf(participant: ParticipantDto): number | null {
  return participant.perks?.styles?.find((s) => s.description === 'subStyle')?.style ?? null;
}

export type RuneDuel = {
  matchId: string;
  gameCreation: number;
  win: boolean;
  champion: string;
  opponentChampion: string | null;
  mine: Keystone | null;
  theirs: Keystone | null;
};

/**
 * His keystone and his lane opponent's, per game.
 *
 * The opponent is picked by `teamPosition` (G-004), the same peer definition the whole project
 * uses (ADR-002). Returns a row even when a keystone is missing, with an explicit null, so the
 * caller can count how much it could not read instead of silently comparing a smaller set.
 */
export function runeDuelOf(match: MatchDto, puuid: string, catalog: RuneCatalog): RuneDuel | null {
  const me = match.info.participants.find((p) => p.puuid === puuid);
  if (me === undefined || me.teamPosition === '') return null;
  const opponent = match.info.participants.find(
    (p) => p.teamPosition === me.teamPosition && p.teamId !== me.teamId,
  );
  return {
    matchId: match.metadata.matchId,
    gameCreation: match.info.gameCreation,
    win: me.win,
    champion: me.championName,
    opponentChampion: opponent?.championName ?? null,
    mine: keystoneOf(me, catalog),
    theirs: opponent === undefined ? null : keystoneOf(opponent, catalog),
  };
}

export type KeystoneRow = {
  /** The numeric id, because that is the name the downloaded icon is stored under. */
  runeId: number;
  key: string;
  name: string;
  treeName: string;
  icon: string;
  jugadas: number;
  ganadas: number;
  /** NaN when he has never run it — never 0, which reads as "he always loses with it". */
  winRate: number;
};

/**
 * How his games went by the keystone he chose.
 *
 * A DESCRIPTION, and the module says so where a reader will see it: he does not choose a
 * keystone at random, he chooses it for the matchup and the champion, so a keystone's win rate
 * carries every reason he picked it. Nothing here is ranked, nothing is called better, and the
 * `jugadas` column is beside every rate for the same reason it is in the champion table — a
 * five-game rate is a coin flip with a name on it.
 */
export function byKeystone(duels: RuneDuel[], quien: 'mine' | 'theirs' = 'mine'): KeystoneRow[] {
  const por = new Map<string, KeystoneRow>();
  for (const duel of duels) {
    const k = duel[quien];
    if (k === null) continue;
    const row = por.get(k.key) ?? {
      runeId: k.runeId,
      key: k.key,
      name: k.name,
      treeName: k.treeName,
      icon: k.icon,
      jugadas: 0,
      ganadas: 0,
      winRate: Number.NaN,
    };
    row.jugadas += 1;
    // Read from HIS perspective in both modes: "games where the opponent ran Electrocute and I
    // won" is the useful question, not "games the opponent won", which is its complement.
    if (duel.win) row.ganadas += 1;
    por.set(k.key, row);
  }
  return [...por.values()]
    .map((r) => ({ ...r, winRate: r.jugadas === 0 ? Number.NaN : r.ganadas / r.jugadas }))
    .sort((a, b) => b.jugadas - a.jugadas || a.name.localeCompare(b.name));
}

/** Games whose keystone could not be read, split by cause — never dropped in silence. */
export function unreadableKeystones(duels: RuneDuel[]): { mias: number; suyas: number } {
  return {
    mias: duels.filter((d) => d.mine === null).length,
    suyas: duels.filter((d) => d.theirs === null).length,
  };
}
