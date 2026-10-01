/** Shapes of the JSON snapshots in public/data (written by scripts/fetch-data.mjs) and of generator output. */

export type SlotType = 'weapon' | 'vitality' | 'spirit';
export type PhaseId = 'early' | 'mid' | 'late';
export type StyleId = 'gun' | 'spirit' | 'hybrid';

// ------------------------------------------------------------------ catalog

export interface PropertyInfo {
  value?: string | number;
  label?: string;
  prefix?: string;
  postfix?: string;
  css_class?: string;
  display_units?: string;
  negative_attribute?: boolean;
  loc_token_override?: string;
}

export interface TooltipAttribute {
  loc_string?: string;
  properties?: string[];
  elevated_properties?: string[];
  important_properties?: string[];
}

export interface TooltipSection {
  section_type?: 'innate' | 'passive' | 'active';
  section_attributes: TooltipAttribute[];
}

export interface CatalogItem {
  id: number;
  class_name: string;
  name: string;
  type: string;
  item_slot_type: SlotType;
  item_tier: number;
  cost: number;
  shopable: boolean;
  disabled: boolean;
  activation?: string;
  is_active_item: boolean;
  component_items: string[];
  shop_image?: string;
  shop_image_webp?: string;
  image?: string;
  image_webp?: string;
  description: Record<string, string>;
  tooltip_sections: TooltipSection[];
  properties: Record<string, PropertyInfo>;
}

export interface CatalogSnapshot {
  source: string;
  fetchedAt: string;
  items: CatalogItem[];
}

// ------------------------------------------------------------------ heroes

export interface HeroBasics {
  id: number;
  class_name: string;
  name: string;
  hero_type: string | null;
  tags: string[];
  gun_tag: string | null;
  complexity: number | null;
  images: Record<string, string>;
}

export interface HeroListSnapshot {
  fetchedAt: string;
  heroes: HeroBasics[];
}

export interface ScaleFunction {
  class_name?: string;
  subclass_name?: string;
  specific_stat_scale_type?: string;
  stat_scale?: number;
}

export interface AbilityProperty extends PropertyInfo {
  scale_function?: ScaleFunction;
}

export interface AbilityUpgrade {
  property_upgrades?: { name: string; bonus: string | number }[];
  t2_desc?: string;
  t3_desc?: string;
}

export interface AbilityInfo {
  id: number;
  class_name: string;
  name: string;
  slot: string;
  ability_type: string;
  image?: string;
  image_webp?: string;
  description: Record<string, string>;
  upgrades: AbilityUpgrade[];
  properties: Record<string, AbilityProperty>;
}

export interface CostBonus {
  gold_threshold: number;
  bonus: number;
  percent_on_graph?: number;
}

export interface WeaponInfo {
  bullet_damage?: number;
  bullets?: number;
  burst_shot_count?: number;
  cycle_time?: number;
  intra_burst_cycle_time?: number;
  clip_size?: number;
  reload_duration?: number;
  range?: number;
}

export interface HeroKit extends HeroBasics {
  description: Record<string, string>;
  starting_stats: Record<string, number>;
  cost_bonuses: Partial<Record<SlotType, CostBonus[]>>;
  standard_level_up_upgrades: Record<string, number>;
  item_slot_info: Partial<Record<SlotType, { max_purchases_for_tier?: number[] }>>;
  level_requirements: Record<string, number | null>;
  weapon: { class_name: string; name: string; weapon_info: WeaponInfo } | null;
  abilities: AbilityInfo[];
}

// ------------------------------------------------------------------ aggregate analytics

export interface ItemStatRow {
  item_id: number;
  wins: number;
  losses: number;
  matches: number;
  players: number;
  avg_buy_time_s?: number;
  avg_sell_time_s?: number;
}

export interface AnalyticsQuery {
  min_unix_timestamp: number;
  min_average_badge: number;
  match_mode: string;
  game_mode: string;
  hero_id?: number;
  [key: string]: string | number | undefined;
}

export interface ItemStatsSnapshot {
  query: AnalyticsQuery;
  fetchedAt: string;
  rows: ItemStatRow[];
}

export interface AbilityOrderSnapshot {
  query: AnalyticsQuery;
  fetchedAt: string;
  note?: string;
  /** Sequence characters index into this array (base-36 digits). */
  abilityIds: number[];
  totalMatches: number;
  totalRows: number;
  keptRows: number;
  coveredMatches: number;
  /** [sequence, wins, losses] */
  rows: [string, number, number][];
}

export interface PermutationSnapshot {
  query: AnalyticsQuery;
  fetchedAt: string;
  note?: string;
  totalRows: number;
  /** [itemA, itemB, wins, losses] for players who bought both */
  rows: [number, number, number, number][];
}

export interface HeroStatsRow {
  hero_id: number;
  wins: number;
  losses: number;
  matches: number;
  total_net_worth?: number;
  total_kills?: number;
  total_deaths?: number;
  total_assists?: number;
}

export interface HeroStatsSnapshot {
  query: AnalyticsQuery;
  fetchedAt: string;
  rows: HeroStatsRow[];
}

export interface MetaSnapshot {
  schema: number;
  fetchedAt: string;
  api: string;
  analytics: {
    window: { minUnixTimestamp: number; latestPatchUnix: number; days: number };
    minAverageBadge: number;
    rankFloor: string | null;
    matchMode: string;
    gameMode: string;
    corruptedItems: string;
  };
  counts: { catalogItems: number; shopableItems: number; heroes: number };
  images?: { available: number; failed: number };
  heroIds: number[];
  validationData: { included: boolean; account_id?: number; hero_id?: number; matches?: number; skipped?: number; fetchedAt?: string };
}

// ------------------------------------------------------------------ generator

/** Everything the generator may read. Aggregate analytics and assets only. */
export interface AggregateInputs {
  catalog: CatalogItem[];
  kit: HeroKit;
  itemStats: ItemStatsSnapshot;
  abilityOrder: AbilityOrderSnapshot;
  permutations: PermutationSnapshot;
  heroStats: HeroStatsRow;
}

export interface TermContribution {
  term: string;
  /** weighted contribution to the pick score */
  value: number;
}

export interface BuildItem {
  itemId: number;
  name: string;
  slot: SlotType;
  tier: number;
  phase: PhaseId;
  /** final = still in the inventory at the end of the build; component = bought earlier and upgraded into a later item */
  role: 'final' | 'component';
  /** catalog price */
  cost: number;
  /** price after credit for owned components */
  netCost: number;
  /** running soul total after this purchase */
  running: number;
  /** item ids consumed (upgraded) by this purchase */
  consumes: number[];
  /** item id of the later purchase that upgrades this one (components only) */
  upgradedInto: number | null;
  /** aggregate evidence for this hero */
  evidence: {
    matches: number;
    winRate: number;
    pickRate: number;
    /** shrunk win-rate minus the win rate expected for items bought at the same time */
    winLift: number;
    avgBuyTimeS: number | null;
  };
  score: number;
  terms: TermContribution[];
  reasons: string[];
}

export interface AbilityPoint {
  point: number;
  abilityId: number;
  abilityName: string;
  kind: 'unlock' | 'upgrade';
  /** 0 for the unlock, 1..3 for upgrade tiers */
  tier: number;
  /** appended after the sequences in the data ended (the ability never appeared on the chosen path) */
  beyondData?: boolean;
}

export interface AbilityPlan {
  points: AbilityPoint[];
  unlockOrder: number[];
  perAbility: { abilityId: number; name: string; unlockPoint: number; upgradePoints: number[] }[];
  support: {
    /** matches whose ability order starts with the first N chosen points, for N = 4, 8, 12, full */
    pathMatches: number[];
    sequencesConsidered: number;
    totalMatches: number;
  };
}

export interface Build {
  id: StyleId;
  name: string;
  tagline: string;
  items: BuildItem[];
  totalCost: number;
  finalItemIds: number[];
  slotSpend: Record<SlotType, number>;
  abilityPlan: AbilityPlan;
}

export interface KitSummary {
  spiritDependence: number;
  dot: boolean;
  gunCoupled: boolean;
  charges: boolean;
  crowdControl: boolean;
  abilities: { id: number; name: string; kind: string; base: number; scale: number; cooldown: number | null; coupledToGun: boolean }[];
  weapon: { dps: number; sustainedDps: number; reloadShare: number };
  growth: { techPowerPerLevel: number; bulletDamagePerLevel: number; healthPerLevel: number };
}

export interface BuildSet {
  generatorVersion: string;
  heroId: number;
  heroName: string;
  builds: Build[];
  budget: number;
  heroMatches: number;
  heroWinRate: number;
  kit: KitSummary;
  snapshot: { fetchedAt: string; minUnixTimestamp: number; minAverageBadge: number };
}
