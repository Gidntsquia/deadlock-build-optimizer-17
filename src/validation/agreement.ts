/**
 * How closely a generated build matches the reference player's core set.
 *
 *   agreement = OVERLAP_WEIGHT * overlap + ORDER_WEIGHT * orderConcordance
 *
 *   overlap          F1 of precision (share of the build's items that are core) and recall (share of the core
 *                    items the build contains). Components that the build buys and later upgrades count as items.
 *   orderConcordance share of item pairs, among items in both the build and the core set, that the build buys in the
 *                    same order as the player's median first-purchase times (ties count half).
 *
 * This is a report on how well the generator did. Nothing here feeds back into the generator.
 */
import type { Build } from '../types';
import type { BuildAgreement, CoreSet, ItemBadge } from './types';

export const OVERLAP_WEIGHT = 0.7;
export const ORDER_WEIGHT = 0.3;

export function badgesFor(itemIds: number[], core: CoreSet): Record<number, ItemBadge> {
  const byId = new Map(core.usage.map((u) => [u.itemId, u]));
  const out: Record<number, ItemBadge> = {};
  for (const id of itemIds) {
    const u = byId.get(id);
    out[id] = u
      ? { itemId: id, status: u.core ? 'core' : 'experiment', matches: u.matches, rawFreq: u.rawFreq, weightedFreq: u.weightedFreq }
      : { itemId: id, status: 'unseen', matches: 0, rawFreq: 0, weightedFreq: 0 };
  }
  return out;
}

export function scoreBuild(build: Build, core: CoreSet): BuildAgreement {
  const buildIds = build.items.map((i) => i.itemId);
  const buildSet = new Set(buildIds);
  const coreIds = core.core.map((u) => u.itemId);
  const coreSet = new Set(coreIds);

  const shared = buildIds.filter((id) => coreSet.has(id));
  const missed = coreIds.filter((id) => !buildSet.has(id));
  const precision = buildIds.length ? shared.length / buildIds.length : 0;
  const recall = coreIds.length ? shared.length / coreIds.length : 0;
  const overlap = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // order of shared items: the build's buy-list order against the player's median first-buy time
  const medianBuy = new Map(core.core.map((u) => [u.itemId, u.medianBuyS]));
  let concordance: number | null = null;
  if (shared.length >= 2) {
    let score = 0;
    let pairs = 0;
    for (let i = 0; i < shared.length; i++) {
      for (let j = i + 1; j < shared.length; j++) {
        const a = medianBuy.get(shared[i])!;
        const b = medianBuy.get(shared[j])!;
        pairs++;
        if (a < b) score += 1;
        else if (a === b) score += 0.5;
      }
    }
    concordance = score / pairs;
  }

  // with fewer than two shared items there is no order to compare; only overlap counts then
  const pct = concordance === null ? overlap * 100 : (OVERLAP_WEIGHT * overlap + ORDER_WEIGHT * concordance) * 100;

  return {
    buildId: build.id,
    agreementPct: Math.round(pct * 10) / 10,
    overlap,
    precision,
    recall,
    orderConcordance: concordance,
    sharedItemIds: shared,
    missedCoreItemIds: missed,
    badges: badgesFor(buildIds, core),
  };
}
