import type { StyleId } from '../types';

/** One sampled match from the validation snapshot (catalog items only). */
export interface ValidationMatch {
  match_id: number;
  start_time: number;
  duration_s: number;
  match_mode: number;
  won: boolean;
  net_worth: number;
  purchases: { item_id: number; bought_s: number; sold_s: number | null }[];
}

export interface ValidationSnapshot {
  account_id: number;
  hero_id: number;
  fetchedAt: string;
  note: string;
  matches: ValidationMatch[];
}

/** How often the reference player bought one item. */
export interface ItemUsage {
  itemId: number;
  /** matches that contain the item (bought at any time, counted once per match) */
  matches: number;
  wins: number;
  /** matches / sampled matches */
  rawFreq: number;
  /** win-weighted share of matches (a win counts `winWeight` times) */
  weightedFreq: number;
  /** median first-purchase time over the matches that contain it, in game seconds */
  medianBuyS: number;
  core: boolean;
}

export interface CoreSet {
  matches: number;
  wins: number;
  threshold: number;
  winWeight: number;
  usage: ItemUsage[];
  /** items at or above the threshold, sorted by median buy time */
  core: ItemUsage[];
  /** items bought at least once but below the threshold: one-off experiments, left out */
  experiments: ItemUsage[];
}

export type BadgeStatus = 'core' | 'experiment' | 'unseen';

export interface ItemBadge {
  itemId: number;
  status: BadgeStatus;
  matches: number;
  rawFreq: number;
  weightedFreq: number;
}

export interface BuildAgreement {
  buildId: StyleId;
  /** 0 to 100, rounded to one decimal */
  agreementPct: number;
  /** F1 of precision and recall between the build's items and the core set, 0 to 1 */
  overlap: number;
  /** share of build items that are core, 0 to 1 */
  precision: number;
  /** share of core items the build contains, 0 to 1 */
  recall: number;
  /** share of ordered pairs of shared items bought in the same order, null with fewer than two shared items */
  orderConcordance: number | null;
  sharedItemIds: number[];
  missedCoreItemIds: number[];
  badges: Record<number, ItemBadge>;
}

export interface ValidationReport {
  matches: number;
  wins: number;
  threshold: number;
  winWeight: number;
  overlapWeight: number;
  orderWeight: number;
  coreItemIds: number[];
  experimentCount: number;
  core: CoreSet;
  builds: BuildAgreement[];
}
