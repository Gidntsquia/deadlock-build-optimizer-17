/**
 * Loads the aggregate snapshots written by `npm run fetch-data` (public/data/...).
 * Works in the browser (fetch) and in Node scripts (fs) through a small fetcher function.
 * Nothing here touches the validation data.
 */
import type {
  AbilityOrderSnapshot,
  AggregateInputs,
  CatalogItem,
  CatalogSnapshot,
  HeroBasics,
  HeroKit,
  HeroListSnapshot,
  HeroStatsRow,
  HeroStatsSnapshot,
  ItemStatsSnapshot,
  MetaSnapshot,
  PermutationSnapshot,
  PlayerHistorySnapshot,
} from '../types';

/** Reads a JSON file under the data folder, e.g. "catalog.json" or "analytics/item-stats-1.json". */
export type JsonFetcher = (path: string) => Promise<unknown>;

export interface SharedData {
  meta: MetaSnapshot;
  catalog: CatalogItem[];
  heroes: HeroBasics[];
  heroStats: HeroStatsRow[];
}

export function browserFetcher(base = import.meta.env.BASE_URL): JsonFetcher {
  return async (path) => {
    const res = await fetch(`${base}data/${path}`);
    if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
    return res.json();
  };
}

export async function loadShared(f: JsonFetcher): Promise<SharedData> {
  const [meta, catalog, heroes, heroStats] = await Promise.all([
    f('meta.json') as Promise<MetaSnapshot>,
    f('catalog.json') as Promise<CatalogSnapshot>,
    f('heroes.json') as Promise<HeroListSnapshot>,
    f('analytics/hero-stats.json') as Promise<HeroStatsSnapshot>,
  ]);
  return { meta, catalog: catalog.items, heroes: heroes.heroes, heroStats: heroStats.rows };
}

export async function loadHeroInputs(f: JsonFetcher, shared: SharedData, heroId: number): Promise<AggregateInputs> {
  const [kit, itemStats, abilityOrder, permutations] = await Promise.all([
    f(`heroes/${heroId}.json`) as Promise<HeroKit>,
    f(`analytics/item-stats-${heroId}.json`) as Promise<ItemStatsSnapshot>,
    f(`analytics/ability-order-${heroId}.json`) as Promise<AbilityOrderSnapshot>,
    f(`analytics/permutation-stats-${heroId}.json`) as Promise<PermutationSnapshot>,
  ]);
  const heroStats = shared.heroStats.find((r) => r.hero_id === heroId) ?? { hero_id: heroId, wins: 0, losses: 0, matches: 0 };
  return { catalog: shared.catalog, kit, itemStats, abilityOrder, permutations, heroStats };
}

export async function loadPlayerHistory(f: JsonFetcher): Promise<PlayerHistorySnapshot> {
  return (await f('player/match-history.json')) as PlayerHistorySnapshot;
}
