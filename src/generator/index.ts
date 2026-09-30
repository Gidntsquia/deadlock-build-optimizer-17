/**
 * Build generator entry point.
 *
 * generateBuilds(inputs, params) is a pure function of the hero's aggregate snapshots and the item catalog.
 * It reads no other data, uses no randomness and no clock, and breaks every tie by item id, so the same
 * snapshot always gives the same builds.
 */
import type { AggregateInputs, Build, BuildSet, SlotType, StyleId } from '../types';
import { planAbilities } from './abilities';
import { planPurchases, selectPicks, type BuilderContext } from './builder';
import { buildPairIndex, computeEvidence } from './evidence';
import { buildItemModels } from './itemModel';
import { buildKitProfile } from './kit';
import { DEFAULT_PARAMS, GENERATOR_VERSION, type GeneratorParams } from './params';
import { hashString, stableStringify } from './util';

export { DEFAULT_PARAMS, GENERATOR_VERSION } from './params';
export type { GeneratorParams } from './params';

const STYLE_NAMES: Record<StyleId, { name: string; tagline: (spiritBurn: boolean) => string }> = {
  gun: {
    name: 'Gun Damage',
    tagline: () => 'Weapon damage, fire rate and magazine first. Spirit items only where they are cheap or strong.',
  },
  spirit: {
    name: 'Spirit & Burn',
    tagline: (burn) => (burn ? 'Spirit power, cooldowns and duration to push ability and burn damage.' : 'Spirit power, cooldowns and duration to push ability damage.'),
  },
  hybrid: {
    name: 'Hybrid',
    tagline: () => 'Splits souls between gun and spirit items and keeps more health.',
  },
};

export function generateBuilds(inputs: AggregateInputs, overrides?: Partial<GeneratorParams>, trace?: BuilderContext['trace']): BuildSet {
  const params: GeneratorParams = { ...DEFAULT_PARAMS, ...overrides };
  const profile = buildKitProfile(inputs.kit);
  const models = buildItemModels(inputs.catalog, params);

  const hs = inputs.heroStats;
  const itemRows = inputs.itemStats.rows;
  const heroMatches = hs.matches > 0 ? hs.matches : itemRows.reduce((m, r) => Math.max(m, r.matches), 0);
  const heroWinRate = hs.matches > 0 ? hs.wins / hs.matches : 0.5;
  const avgNetWorth = hs.matches > 0 && hs.total_net_worth ? hs.total_net_worth / hs.matches : 40000;

  const evidence = computeEvidence(itemRows, heroMatches, heroWinRate, params);
  const pairs = buildPairIndex(inputs.permutations, evidence, heroWinRate, params);
  const budget = Math.round(avgNetWorth * params.budgetShare);

  const ctx: BuilderContext = { profile, params, models, evidence, pairs, budget, heroName: inputs.kit.name, trace };

  const builds: Build[] = params.styles.map((style) => {
    const picks = selectPicks(ctx, style);
    const items = planPurchases(ctx, picks);
    const slotSpend: Record<SlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
    for (const it of items) if (it.role === 'final') slotSpend[it.slot] += it.cost;
    const names = STYLE_NAMES[style.id];
    return {
      id: style.id,
      name: names.name,
      tagline: names.tagline(profile.summary.dot),
      items,
      totalCost: items.length ? items[items.length - 1].running : 0,
      finalItemIds: items.filter((i) => i.role === 'final').map((i) => i.itemId),
      slotSpend,
      abilityPlan: planAbilities(inputs.abilityOrder, inputs.kit, profile, style, params),
    };
  });

  return {
    generatorVersion: GENERATOR_VERSION,
    heroId: inputs.kit.id,
    heroName: inputs.kit.name,
    builds,
    budget,
    heroMatches,
    heroWinRate,
    kit: profile.summary,
    snapshot: {
      fetchedAt: inputs.itemStats.fetchedAt,
      minUnixTimestamp: inputs.itemStats.query.min_unix_timestamp,
      minAverageBadge: inputs.itemStats.query.min_average_badge,
    },
  };
}

/** Hash of a build set with floats rounded; equal hashes mean identical builds. */
export function hashBuildSet(set: BuildSet): string {
  return hashString(stableStringify(set));
}
