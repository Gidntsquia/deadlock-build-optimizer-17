/** Loads everything the app needs once at start, and builds per-hero results on demand. */
import { generateBuilds } from '../generator';
import { computeInsight, type PersonalInsight } from '../personalization';
import type { BuildSet, CatalogItem, HeroKit, PlayerHistorySnapshot } from '../types';
import { loadValidationSnapshot, validateBuildSet, type ValidationReport, type ValidationSnapshot } from '../validation';
import type { ImageManifest } from './assets';
import { browserFetcher, loadHeroInputs, loadPlayerHistory, loadShared, type JsonFetcher, type SharedData } from './snapshots';

export interface AppData {
  fetcher: JsonFetcher;
  shared: SharedData;
  manifest: ImageManifest;
  history: PlayerHistorySnapshot | null;
  validation: ValidationSnapshot | null;
  itemsById: Map<number, CatalogItem>;
  itemsByClass: Map<string, CatalogItem>;
}

/** Hero whose builds are checked against the validation snapshot. */
export const VALIDATION_HERO_ID = 1;
export const DEFAULT_HERO_ID = 1;

export async function loadAppData(fetcher: JsonFetcher = browserFetcher()): Promise<AppData> {
  const optional = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [shared, manifest, history, validation] = await Promise.all([
    loadShared(fetcher),
    optional(fetcher('img/manifest.json') as Promise<ImageManifest>),
    optional(loadPlayerHistory(fetcher)),
    optional(loadValidationSnapshot(fetcher)),
  ]);
  const itemsById = new Map<number, CatalogItem>();
  const itemsByClass = new Map<string, CatalogItem>();
  for (const it of shared.catalog) {
    itemsById.set(it.id, it);
    // two catalog entries can share a class name; the shopable one is the real item
    const prev = itemsByClass.get(it.class_name);
    if (!prev || (!prev.shopable && it.shopable)) itemsByClass.set(it.class_name, it);
  }
  return { fetcher, shared, manifest: manifest ?? {}, history, validation, itemsById, itemsByClass };
}

export interface HeroResult {
  set: BuildSet;
  kit: HeroKit;
  report: ValidationReport | null;
  insight: PersonalInsight | null;
}

export async function loadHeroResult(app: AppData, heroId: number): Promise<HeroResult> {
  const inputs = await loadHeroInputs(app.fetcher, app.shared, heroId);
  const set = generateBuilds(inputs);
  const report = heroId === VALIDATION_HERO_ID && app.validation ? validateBuildSet(set, app.validation) : null;
  const insight = app.history ? computeInsight(app.history, heroId) : null;
  return { set, kit: inputs.kit, report, insight };
}
