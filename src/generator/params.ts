/**
 * Every weight and constant the generator uses, in one place. The README documents each one.
 * The generator is a pure function of (aggregate snapshots, these params): no randomness, no clock.
 */
import type { PhaseId, SlotType, StyleId } from '../types';

export const GENERATOR_VERSION = '1.0.0';

export interface PhaseWeights {
  /** shrunk win-rate lift against items bought at the same time (evidence) */
  win: number;
  /** how often players of this hero buy the item (evidence) */
  pick: number;
  /** stat value per soul from the power model (innate stats, thresholds, passives/actives) */
  power: number;
  /** kit-specific fit (charges, range/duration, crowd control for heroes whose abilities use them) */
  kit: number;
  /** pair synergy with items already chosen (permutation stats) */
  pair: number;
  /** how well the item's typical buy time matches the phase */
  timing: number;
}

export interface PhasePlanStep {
  phase: PhaseId;
  /** final items picked in this phase */
  count: number;
  /** lowest tier of a newly bought (not upgraded) item in this phase */
  minTier: number;
  /** highest tier of any pick in this phase */
  maxTier: number;
  /** at most this many new picks from the same slot type inside the phase */
  maxPerSlot: number;
  /** upgrades of items already owned (they consume the component) allowed in this phase, on top of `count` */
  maxUpgrades: number;
}

export interface StyleDef {
  id: StyleId;
  /** weight on gun damage per second in the power model */
  aGun: number;
  /** weight on spirit damage per second */
  aSpirit: number;
  /** weight on effective health */
  aSurv: number;
  /** weight on utility (crowd control, mobility) */
  aUtil: number;
  /** score added to every candidate of a slot type, so a gun build leans on weapon items and a spirit build on spirit items */
  slotBias: Record<SlotType, number>;
}

export interface GeneratorParams {
  // ---- evidence
  /** items below this many matches for the hero are not candidates */
  minMatches: number;
  /** items bought in fewer than this share of the hero's matches are not candidates */
  minPickRate: number;
  /** prior strength (in matches) that pulls each item's win rate toward its buy-time baseline */
  shrinkMatches: number;
  /** Gaussian kernel width (seconds) for the buy-time win-rate baseline */
  baselineBandwidthS: number;
  /** weight of the hero's overall win rate inside the baseline (in sqrt-match units) */
  baselinePrior: number;
  /** a shrunk lift of this size (win-rate fraction) scores 1.0 */
  winLiftScale: number;
  /** pick rates at or above this score 1.0 */
  pickRateCap: number;
  /** win-lift evidence is discounted below this pick rate (weight = sqrt(pick / this)) */
  reliablePickRate: number;
  /** pair lift of this size scores 1.0 */
  pairLiftScale: number;
  /** prior strength (matches) for pair lifts */
  pairShrinkMatches: number;

  // ---- power model
  /** share of gun shots that land */
  accuracy: number;
  /** share of landed bullets that are headshots (for flat headshot bonuses) */
  headshotRate: number;
  /** assumed uptime of a passive effect with no stated cooldown/duration */
  passiveUptime: number;
  /** assumed uptime of an active effect with no stated cooldown/duration */
  activeUptime: number;
  /** longest cooldown reduction the model credits */
  maxCdr: number;
  /** shortest time between two casts the model credits (seconds) */
  minCycleS: number;
  /** seconds of a typical fight, used to turn barriers/heals into effective health */
  fightS: number;
  /** souls the hero has earned but not spent, added to spend when estimating level */
  unspentSouls: number;
  /** weight of each damage type when blending resistances into effective health */
  bulletShare: number;
  /** a power gain of this many ln-units per 1000 souls scores 1.0 */
  powerRefPerK: number;
  /** ln-power value of one utility unit (crowd control, mobility) */
  utilityUnit: number;

  // ---- selection
  plan: PhasePlanStep[];
  phaseWeights: Record<PhaseId, PhaseWeights>;
  /** each phase's buy-time window in seconds; items bought outside it lose "timing" score */
  phaseWindowS: Record<PhaseId, [number, number]>;
  /** the inventory holds at most this many items of one slot type (weapon, vitality, spirit) at any time */
  maxPerSlot: number;
  /** the inventory holds at most this many items with an active ability at any time */
  maxActives: number;
  /** budget = this share of the hero's average end-of-match net worth */
  budgetShare: number;
  /** components the build buys early and upgrades later, when the upgrade was picked without its component */
  stones: {
    /** a component must be bought in at least this share of the hero's matches */
    minPickRate: number;
    /** highest tier of component that may be used as a stepping stone */
    maxTier: number;
    /** most stepping stones per build */
    max: number;
  };
  /** thresholds used only when no candidate passes the normal ones, so every build still reaches its full size */
  fallback: {
    /** relaxed match-count floor */
    minMatches: number;
    /** relaxed pick-rate floor */
    minPickRate: number;
    /** share of the budget a build may exceed while relaxed */
    budgetSlack: number;
  };
  styles: StyleDef[];

  // ---- ability order
  ability: {
    /** a branch needs at least this share of the prefix's matches to be considered */
    minBranchShare: number;
    /** prior strength (matches) for branch win rates */
    shrinkMatches: number;
    /** win-rate points (fraction) added per unit of style affinity, to break near-ties */
    styleTilt: number;
  };
}

export const DEFAULT_PARAMS: GeneratorParams = {
  minMatches: 150,
  minPickRate: 0.05,
  shrinkMatches: 500,
  baselineBandwidthS: 240,
  baselinePrior: 10,
  winLiftScale: 0.02,
  pickRateCap: 0.6,
  reliablePickRate: 0.1,
  pairLiftScale: 0.02,
  pairShrinkMatches: 800,

  accuracy: 0.7,
  headshotRate: 0.2,
  passiveUptime: 0.4,
  activeUptime: 0.25,
  maxCdr: 0.6,
  minCycleS: 3,
  fightS: 10,
  unspentSouls: 600,
  bulletShare: 0.6,
  powerRefPerK: 0.05,
  utilityUnit: 0.05,

  plan: [
    { phase: 'early', count: 3, minTier: 1, maxTier: 2, maxPerSlot: 2, maxUpgrades: 2 },
    { phase: 'mid', count: 5, minTier: 2, maxTier: 3, maxPerSlot: 3, maxUpgrades: 3 },
    { phase: 'late', count: 4, minTier: 3, maxTier: 5, maxPerSlot: 3, maxUpgrades: 3 },
  ],
  phaseWeights: {
    early: { win: 0.6, pick: 1.0, power: 1.2, kit: 0.4, pair: 0.3, timing: 0.5 },
    mid: { win: 1.0, pick: 0.8, power: 1.0, kit: 0.5, pair: 0.6, timing: 0.5 },
    late: { win: 1.2, pick: 0.6, power: 0.9, kit: 0.6, pair: 0.8, timing: 0.4 },
  },
  phaseWindowS: { early: [0, 600], mid: [420, 1260], late: [900, 4000] },
  maxPerSlot: 6,
  maxActives: 3,
  budgetShare: 0.9,
  stones: { minPickRate: 0.15, maxTier: 2, max: 5 },
  fallback: { minMatches: 40, minPickRate: 0.005, budgetSlack: 0.1 },
  styles: [
    { id: 'gun', aGun: 1.0, aSpirit: 0.25, aSurv: 0.35, aUtil: 0.3, slotBias: { weapon: 0.6, vitality: 0, spirit: -0.25 } },
    { id: 'spirit', aGun: 0.25, aSpirit: 1.0, aSurv: 0.35, aUtil: 0.3, slotBias: { weapon: -0.25, vitality: 0, spirit: 0.6 } },
    { id: 'hybrid', aGun: 0.6, aSpirit: 0.6, aSurv: 0.4, aUtil: 0.3, slotBias: { weapon: 0, vitality: 0, spirit: 0 } },
  ],

  ability: { minBranchShare: 0.2, shrinkMatches: 60, styleTilt: 0.01 },
};
