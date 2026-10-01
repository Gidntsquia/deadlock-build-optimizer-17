/**
 * Validation step. This folder is the only code that reads the reference player's snapshot
 * (public/data/zergggy/purchases-infernus.json). The generator never imports from here.
 */
import type { JsonFetcher } from '../data/snapshots';
import type { Build } from '../types';
import { ORDER_WEIGHT, OVERLAP_WEIGHT, scoreBuild } from './agreement';
import { computeCoreSet } from './core';
import type { ValidationReport, ValidationSnapshot } from './types';

export const VALIDATION_FILE = 'zergggy/purchases-infernus.json';
export { CORE_THRESHOLD, WIN_WEIGHT, computeCoreSet } from './core';
export { ORDER_WEIGHT, OVERLAP_WEIGHT, badgesFor, scoreBuild } from './agreement';
export type * from './types';

export async function loadValidationSnapshot(f: JsonFetcher): Promise<ValidationSnapshot> {
  return (await f(VALIDATION_FILE)) as ValidationSnapshot;
}

/** Scores the build against the core set computed from the validation snapshot. */
export function validateBuild(build: Build, snapshot: ValidationSnapshot): ValidationReport {
  const core = computeCoreSet(snapshot.matches);
  return {
    matches: core.matches,
    wins: core.wins,
    threshold: core.threshold,
    winWeight: core.winWeight,
    overlapWeight: OVERLAP_WEIGHT,
    orderWeight: ORDER_WEIGHT,
    coreItemIds: core.core.map((u) => u.itemId),
    experimentCount: core.experiments.length,
    core,
    agreement: scoreBuild(build, core),
  };
}
