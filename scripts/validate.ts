/**
 * Validation report for Infernus (the only hero with validation data).
 *   npm run validate            -> core set and agreement
 *   npm run validate -- --json  -> the full report as JSON
 * Generation happens first and never sees the validation snapshot; this step only compares the result to it.
 */
import { loadHeroInputs, loadShared } from '../src/data/snapshots';
import { DEFAULT_PARAMS, generateBuild, hashBuild } from '../src/generator';
import { hashString, stableStringify } from '../src/generator/util';
import { loadValidationSnapshot, validateBuild } from '../src/validation';
import { nodeFetcher } from './lib/node-data';

const HERO_ID = 1;

async function main(): Promise<void> {
  const shared = await loadShared(nodeFetcher);
  const inputs = await loadHeroInputs(nodeFetcher, shared, HERO_ID);
  const build = generateBuild(inputs);
  const snapshot = await loadValidationSnapshot(nodeFetcher);
  const report = validateBuild(build, snapshot);
  const names = new Map(shared.catalog.map((c) => [c.id, c.name]));
  const name = (id: number): string => names.get(id) ?? `#${id}`;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...report, core: undefined, coreItems: report.core.core, experiments: report.core.experiments }, null, 2));
    return;
  }

  console.log(`# Validation: ${build.heroName}, ${report.matches} sampled matches (${report.wins} won), fetched ${snapshot.fetchedAt}`);
  console.log(`core rule: item in >= ${report.threshold * 100}% of matches, each win counts ${report.winWeight}x; ${report.core.core.length} core items, ${report.experimentCount} experiments left out`);
  console.log('\ncore items (by median buy time)');
  for (const u of report.core.core) {
    console.log(`  ${name(u.itemId).padEnd(26)} weighted ${(u.weightedFreq * 100).toFixed(0).padStart(3)}%  raw ${(u.rawFreq * 100).toFixed(0).padStart(3)}%  median buy ${String(Math.round(u.medianBuyS)).padStart(5)}s`);
  }
  console.log(`\nagreement = ${report.overlapWeight} * overlap(F1) + ${report.orderWeight} * order concordance`);
  const a = report.agreement;
  const tag = (id: number): string => a.badges[id].status;
  console.log(`\n== ${build.heroName}: ${a.agreementPct.toFixed(1)}%   overlap ${(a.overlap * 100).toFixed(0)}% (precision ${(a.precision * 100).toFixed(0)}%, recall ${(a.recall * 100).toFixed(0)}%)   order ${a.orderConcordance === null ? 'n/a' : (a.orderConcordance * 100).toFixed(0) + '%'}`);
  console.log(`   core items in build: ${a.sharedItemIds.map(name).join(', ') || 'none'}`);
  console.log(`   core items missed:   ${a.missedCoreItemIds.map(name).join(', ') || 'none'}`);
  console.log(`   badges: ${build.items.map((i) => `${i.name} [${tag(i.itemId)}]`).join(', ')}`);
  console.log(`\ngenerator params ${hashString(stableStringify(DEFAULT_PARAMS))}  build ${hashBuild(build)}`);
}

void main();
