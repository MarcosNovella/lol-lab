import type { ChampionCatalog } from '../store/items.ts';
import { championKey } from './names.ts';

/**
 * The opponent's CLASS as a stratum.
 *
 * Every comparison in this project is against the specific opponent he happened to face, which
 * is correct (ADR-002) and gives an n of one per game. The class is the only grouping of
 * opponents that is known BEFORE the game starts, so it is the only one that can be a stratum
 * without inheriting the result (G-008): "how do I do into assassins" is answerable, "how do I
 * do into opponents who ended up fed" is not a question.
 *
 * It is reported as a WHOLE TABLE and never as a headline, because G-028 is exactly about this
 * shape: a claim that names a slice is only about that slice if the other slices disagree, and
 * the other slices have to be printed beside it for anyone to check.
 */

export const CLASES = ['Assassin', 'Fighter', 'Mage', 'Marksman', 'Support', 'Tank'] as const;
export type Clase = (typeof CLASES)[number];

export const CLASE_ES: Record<Clase, string> = {
  Assassin: 'asesino',
  Fighter: 'luchador',
  Mage: 'mago',
  Marksman: 'tirador',
  Support: 'soporte',
  Tank: 'tanque',
};

/**
 * The classes of a champion, by Riot's PascalCase id.
 *
 * A champion has one or TWO — Diana is Fighter and Assassin — and both are kept. Forcing a
 * primary would be inventing a fact Riot does not publish, and it is the sort of invention that
 * looks like data afterwards.
 */
export function clasesDe(champion: string, catalog: ChampionCatalog): Clase[] {
  // Through the normaliser, always (G-016): Riot writes `LeBlanc`, Data Dragon writes
  // `Leblanc`, and a raw lookup returns undefined for her and reports her as unclassified.
  const found = catalog.get(championKey(champion));
  if (found === undefined) return [];
  return found.tags.filter((t): t is Clase => (CLASES as readonly string[]).includes(t));
}

export type FilaClase = {
  clase: Clase;
  etiqueta: string;
  jugadas: number;
  ganadas: number;
  /** NaN when he has never faced the class — never 0, which reads as "he always loses to it". */
  winRate: number;
};

export type Juego = { win: boolean; opponentChampion: string | null };

/**
 * His record against each opponent class.
 *
 * A game against Diana counts in BOTH the Fighter row and the Assassin row, which means the
 * rows do not sum to the number of games — stated here because a reader who adds the column and
 * gets a bigger number than the game count would be right to distrust the whole table. There is
 * no honest alternative: dropping a champion's second class is an invention, and a
 * "Fighter+Assassin" bucket splits the sample into cells of two.
 */
export function porClaseRival(juegos: Juego[], catalog: ChampionCatalog): FilaClase[] {
  const por = new Map<Clase, { jugadas: number; ganadas: number }>();
  for (const juego of juegos) {
    if (juego.opponentChampion === null) continue;
    for (const clase of clasesDe(juego.opponentChampion, catalog)) {
      const row = por.get(clase) ?? { jugadas: 0, ganadas: 0 };
      row.jugadas += 1;
      if (juego.win) row.ganadas += 1;
      por.set(clase, row);
    }
  }
  return [...por]
    .map(([clase, v]) => ({
      clase,
      etiqueta: CLASE_ES[clase],
      jugadas: v.jugadas,
      ganadas: v.ganadas,
      winRate: v.jugadas === 0 ? Number.NaN : v.ganadas / v.jugadas,
    }))
    .sort((a, b) => b.jugadas - a.jugadas);
}

/** Games whose opponent the catalogue could not identify — reported, never silently dropped. */
export function sinClasificar(juegos: Juego[], catalog: ChampionCatalog): number {
  return juegos.filter(
    (j) => j.opponentChampion === null || clasesDe(j.opponentChampion, catalog).length === 0,
  ).length;
}
