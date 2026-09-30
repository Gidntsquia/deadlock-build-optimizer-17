/**
 * Evidence from the aggregate analytics snapshots: per-item usage and win rate, and pair synergy.
 *
 * Raw win rates are biased by timing. Expensive items are bought late and only in games that last,
 * and the team that is ahead buys more of everything. So each item's win rate is compared with the
 * win rate of the other items bought at about the same time (a Gaussian-kernel baseline that leaves the
 * item out), then shrunk toward that baseline by sample size.
 */
import type { ItemStatRow, PermutationSnapshot } from '../types';
import type { GeneratorParams } from './params';

export interface ItemEvidence {
  itemId: number;
  matches: number;
  wins: number;
  winRate: number;
  /** share of the hero's matches in which the item was bought */
  pickRate: number;
  /** expected win rate for items bought at the same time */
  baseline: number;
  /** shrunk win rate minus baseline (fraction, e.g. 0.02 = +2 points) */
  winLift: number;
  avgBuyTimeS: number | null;
}

export function computeEvidence(rows: ItemStatRow[], heroMatches: number, heroWinRate: number, params: GeneratorParams): Map<number, ItemEvidence> {
  const usable = rows.filter((r) => r.matches > 0).slice().sort((a, b) => a.item_id - b.item_id);
  const timed = usable.filter((r) => r.avg_buy_time_s != null && Number.isFinite(r.avg_buy_time_s));
  const out = new Map<number, ItemEvidence>();
  const h = params.baselineBandwidthS;
  const M = Math.max(heroMatches, 1);

  for (const r of usable) {
    const winRate = r.wins / r.matches;
    let baseline = heroWinRate;
    const t = r.avg_buy_time_s;
    if (t != null && Number.isFinite(t)) {
      let num = params.baselinePrior * heroWinRate;
      let den = params.baselinePrior;
      for (const o of timed) {
        if (o.item_id === r.item_id) continue;
        const d = (t - (o.avg_buy_time_s as number)) / h;
        const k = Math.exp(-0.5 * d * d);
        if (k < 1e-4) continue;
        const c = k * Math.sqrt(o.matches);
        num += c * (o.wins / o.matches);
        den += c;
      }
      baseline = num / den;
    }
    const lift = (winRate - baseline) * (r.matches / (r.matches + params.shrinkMatches));
    out.set(r.item_id, {
      itemId: r.item_id,
      matches: r.matches,
      wins: r.wins,
      winRate,
      pickRate: Math.min(1, r.matches / M),
      baseline,
      winLift: lift,
      avgBuyTimeS: t != null && Number.isFinite(t) ? t : null,
    });
  }
  return out;
}

export interface PairIndex {
  /** shrunk synergy lift (fraction) for an unordered pair, or 0 when the pair was not observed */
  lift(a: number, b: number): number;
  observed(a: number, b: number): boolean;
}

/**
 * Pair lift = win rate of players who bought both minus the additive expectation
 * (winRate_a + winRate_b - heroWinRate), shrunk by the pair's sample size.
 */
export function buildPairIndex(perm: PermutationSnapshot, evidence: Map<number, ItemEvidence>, heroWinRate: number, params: GeneratorParams): PairIndex {
  const map = new Map<number, number>();
  const key = (a: number, b: number): number => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (const [a, b, wins, losses] of perm.rows ?? []) {
    const ea = evidence.get(a);
    const eb = evidence.get(b);
    const n = wins + losses;
    if (!ea || !eb || n <= 0) continue;
    const observed = wins / n;
    const expected = ea.winRate + eb.winRate - heroWinRate;
    map.set(key(a, b), (observed - expected) * (n / (n + params.pairShrinkMatches)));
  }
  return {
    lift: (a, b) => map.get(key(a, b)) ?? 0,
    observed: (a, b) => map.has(key(a, b)),
  };
}
