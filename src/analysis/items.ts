import type { MatchDto, TimelineDto } from '../riot/types.ts';
import type { ItemCatalog } from '../store/items.ts';
import { clock, eventsOfType, participantsOf } from './events.ts';

/**
 * When his build actually lands, and when his lane opponent's does.
 *
 * This was CUT from M2 on 2026-08-16 — "ITEM_PURCHASED carries only an itemId and this repo
 * caches no Data Dragon, so component vs legendary is unknowable without inventing the item
 * table" — and it is back because the table is now cached per patch instead of invented.
 *
 * WHAT IT IS NOT: a measure of how well he plays. Item timing is downstream of gold, so a lead
 * buys a faster item and a faster item extends the lead; reading it alone would be the same
 * mistake as the season means. It is reported BESIDE the lane gold difference at that moment and
 * beside the opponent's own timing, which is the comparison ADR-002 makes cheap — the opponent
 * was MMR-matched by Riot and played the same 25 minutes.
 */

/**
 * Gold at or above which a finished item counts as a build step worth timing.
 *
 * ARBITRARY, and stated rather than buried: boots and the cheap finished items (2000ish and
 * below) complete early for everyone and would crowd out the item that actually decides a
 * matchup. Boots are reported separately for that reason instead of being dropped.
 */
export const LEGENDARY_GOLD = 2200;

export type Completion = {
  timestamp: number;
  /** `mm:ss`, so it can be read against the report's other lines. */
  at: string;
  minute: number;
  itemId: number;
  name: string;
  goldTotal: number;
};

export class ItemsError extends Error {}

/**
 * Purchases by one participant, with undone ones removed.
 *
 * `ITEM_UNDO` is real and frequent — ten in the first timeline inspected — and an undone
 * purchase that stays in the list moves a completion earlier than it happened. An undo carries
 * `beforeId` (what he had) and a positive `goldGain` (the refund), so it cancels the most recent
 * surviving purchase of that item.
 */
function purchasesOf(
  timeline: TimelineDto,
  participantId: number,
): { itemId: number; timestamp: number }[] {
  const purchases: { itemId: number; timestamp: number }[] = [];
  const events = [
    ...eventsOfType(timeline, 'ITEM_PURCHASED'),
    ...eventsOfType(timeline, 'ITEM_UNDO'),
  ]
    .filter((e) => e.participantId === participantId)
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const event of events) {
    if (event.type === 'ITEM_PURCHASED') {
      if (typeof event.itemId === 'number')
        purchases.push({ itemId: event.itemId, timestamp: event.timestamp });
      continue;
    }
    const beforeId = event.beforeId ?? 0;
    const refunded = (event.goldGain ?? 0) > 0;
    if (!refunded || beforeId === 0) continue;
    for (let i = purchases.length - 1; i >= 0; i -= 1) {
      if (purchases[i]?.itemId === beforeId) {
        purchases.splice(i, 1);
        break;
      }
    }
  }
  return purchases;
}

/**
 * The finished items one participant completed, in order.
 *
 * A completion is the PURCHASE of an item nothing builds out of: that is the moment the
 * components leave the inventory and the item starts working. Re-buying an item after selling it
 * would count twice, which is rare enough to leave visible rather than to special-case wrongly —
 * the sequence is printed with its minutes, so a duplicate is legible instead of hidden.
 */
export function completionsOf(
  timeline: TimelineDto,
  participantId: number,
  catalog: ItemCatalog,
  minimumGold: number = LEGENDARY_GOLD,
): Completion[] {
  const out: Completion[] = [];
  for (const purchase of purchasesOf(timeline, participantId)) {
    const item = catalog.get(purchase.itemId);
    if (item === undefined || !item.finished || item.goldTotal < minimumGold) continue;
    out.push({
      timestamp: purchase.timestamp,
      at: clock(purchase.timestamp),
      minute: purchase.timestamp / 60_000,
      itemId: purchase.itemId,
      name: item.name,
      goldTotal: item.goldTotal,
    });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

export type ItemRace = {
  mine: Completion[];
  theirs: Completion[];
  /** Aligned by ORDER, not by item: his first against their first, and so on. */
  steps: {
    index: number;
    mine: Completion | null;
    theirs: Completion | null;
    deltaMinutes: number | null;
  }[];
  /** His first completion minus theirs, in minutes. Negative means he got there first. */
  firstGapMinutes: number | null;
};

/**
 * His build timings against his direct lane opponent's.
 *
 * Aligned by order rather than by item, because two mids rarely build the same thing and the
 * question is tempo, not taste: "your first item landed ninety seconds after his" is actionable
 * whatever the two items were.
 */
export function itemRace(
  match: MatchDto,
  timeline: TimelineDto,
  puuid: string,
  catalog: ItemCatalog,
  minimumGold: number = LEGENDARY_GOLD,
): ItemRace | null {
  const participants = participantsOf(match, timeline, puuid);
  if (participants === null) return null;
  const me = match.info.participants.find((p) => p.puuid === puuid);
  if (me === undefined || me.teamPosition === '') return null;
  const myId = participants.idOf(puuid);
  if (myId === null) return null;

  const opponent = match.info.participants.find(
    (p) => p.teamPosition === me.teamPosition && p.teamId !== me.teamId,
  );
  const oppId = opponent === undefined ? null : participants.idOf(opponent.puuid);

  const mine = completionsOf(timeline, myId, catalog, minimumGold);
  const theirs = oppId === null ? [] : completionsOf(timeline, oppId, catalog, minimumGold);

  const steps: ItemRace['steps'] = [];
  for (let i = 0; i < Math.max(mine.length, theirs.length); i += 1) {
    const a = mine[i] ?? null;
    const b = theirs[i] ?? null;
    steps.push({
      index: i + 1,
      mine: a,
      theirs: b,
      deltaMinutes: a === null || b === null ? null : a.minute - b.minute,
    });
  }

  return {
    mine,
    theirs,
    steps,
    firstGapMinutes: steps[0]?.deltaMinutes ?? null,
  };
}
