/**
 * Champion names, reconciled across the three spellings this project has to live with.
 *
 * Riot's `championName` is PascalCase with no separators (`TwistedFate`, `AurelionSol`).
 * op.gg's exports use the display name with spaces (`Twisted Fate`). The vault names its notes
 * in kebab case (`twisted-fate`). Comparing any two of those raw silently drops every
 * multi-word champion, which is not hypothetical: it once produced a report that the vault's
 * data disagreed with the cache when it did not (G-016).
 *
 * The key deliberately throws away every separator instead of trying to reconstruct word
 * boundaries, because reconstructing them is where the ambiguity lives — `Nunu & Willump`,
 * `Kai'Sa`, `Dr. Mundo`, `LeBlanc` and `Renata Glasc` all break a rule that some other name
 * needs.
 */
export function championKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function sameChampion(a: string, b: string): boolean {
  return championKey(a) === championKey(b);
}
