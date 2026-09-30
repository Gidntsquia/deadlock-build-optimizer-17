/**
 * The reference player's "core" item set for one hero.
 *
 * Rule (also in the README): an item is core when it shows up in at least 30% of the sampled matches,
 * with each won match counting 1.5 times. Items below that share are experiments and are left out.
 * "Shows up" means bought at any time in the match, including components that were later merged into an upgrade.
 */
import type { CoreSet, ItemUsage, ValidationMatch } from './types';

export const CORE_THRESHOLD = 0.3;
export const WIN_WEIGHT = 1.5;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function computeCoreSet(matches: ValidationMatch[], threshold = CORE_THRESHOLD, winWeight = WIN_WEIGHT): CoreSet {
  const weightOf = (m: ValidationMatch): number => (m.won ? winWeight : 1);
  const totalWeight = matches.reduce((s, m) => s + weightOf(m), 0);

  const acc = new Map<number, { matches: number; wins: number; weight: number; buys: number[] }>();
  for (const m of matches) {
    const firstBuy = new Map<number, number>();
    for (const p of m.purchases) {
      const prev = firstBuy.get(p.item_id);
      if (prev === undefined || p.bought_s < prev) firstBuy.set(p.item_id, p.bought_s);
    }
    for (const [itemId, t] of firstBuy) {
      const e = acc.get(itemId) ?? { matches: 0, wins: 0, weight: 0, buys: [] };
      e.matches++;
      if (m.won) e.wins++;
      e.weight += weightOf(m);
      e.buys.push(t);
      acc.set(itemId, e);
    }
  }

  const usage: ItemUsage[] = [...acc.entries()]
    .map(([itemId, e]) => {
      const weightedFreq = totalWeight > 0 ? e.weight / totalWeight : 0;
      return {
        itemId,
        matches: e.matches,
        wins: e.wins,
        rawFreq: matches.length ? e.matches / matches.length : 0,
        weightedFreq,
        medianBuyS: median(e.buys),
        core: weightedFreq >= threshold - 1e-9,
      };
    })
    .sort((a, b) => b.weightedFreq - a.weightedFreq || a.itemId - b.itemId);

  return {
    matches: matches.length,
    wins: matches.filter((m) => m.won).length,
    threshold,
    winWeight,
    usage,
    core: usage.filter((u) => u.core).sort((a, b) => a.medianBuyS - b.medianBuyS || a.itemId - b.itemId),
    experiments: usage.filter((u) => !u.core),
  };
}
