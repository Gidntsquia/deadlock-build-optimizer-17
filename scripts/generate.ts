/**
 * Prints the generated build for one or more heroes and a determinism hash.
 *   npm run generate                 -> Infernus
 *   npm run generate -- 2 5 --json   -> other hero ids, JSON output
 *   npm run generate -- --all        -> every hero, one summary line each
 * Reads only the aggregate analytics and assets snapshots.
 */
import { loadHeroInputs, loadShared } from '../src/data/snapshots';
import { DEFAULT_PARAMS, generateBuild, hashBuild } from '../src/generator';
import { hashString, stableStringify } from '../src/generator/util';
import type { Build } from '../src/types';
import { nodeFetcher } from './lib/node-data';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const all = args.includes('--all');
const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);

function printBuild(b: Build): void {
  let phase = '';
  for (const it of b.items) {
    if (it.phase !== phase) {
      phase = it.phase;
      console.log(`  [${phase}]`);
    }
    const tag = it.role === 'final' ? '' : ' (component)';
    const up = it.consumes.length ? ` (upgrades ${it.consumes.length})` : '';
    console.log(
      `   ${String(it.running).padStart(6)}  ${it.name.padEnd(26)} T${it.tier} ${it.slot.padEnd(8)} ${String(it.cost).padStart(5)} net ${String(it.netCost).padStart(5)}  pick ${(it.evidence.pickRate * 100).toFixed(0).padStart(3)}%  wr ${(it.evidence.winRate * 100).toFixed(1)}%  lift ${(it.evidence.winLift * 100).toFixed(1).padStart(5)}  score ${it.score.toFixed(2)}${tag}${up}`,
    );
  }
  console.log(`  total ${b.totalCost} souls; slots ${JSON.stringify(b.slotSpend)}`);
  console.log(`  abilities: ${b.abilityPlan.points.map((p) => `${p.point}:${p.abilityName}${p.kind === 'unlock' ? '*' : ''}`).join(' > ')}`);
  console.log(`  ability support (matches with same first 4/8/12/all points): ${b.abilityPlan.support.pathMatches.join(' / ')} of ${b.abilityPlan.support.totalMatches}`);
}

async function main(): Promise<void> {
  const shared = await loadShared(nodeFetcher);
  const targets = all ? shared.heroes.map((h) => h.id) : ids.length ? ids : [1];
  let failures = 0;
  for (const id of targets) {
    try {
      const inputs = await loadHeroInputs(nodeFetcher, shared, id);
      const a: Build = generateBuild(inputs);
      const b: Build = generateBuild(inputs);
      const hash = hashBuild(a);
      const same = hash === hashBuild(b) && JSON.stringify(a) === JSON.stringify(b);
      if (asJson) console.log(JSON.stringify(a, null, 2));
      else if (all) {
        const short = a.finalItemIds.length < 12 || a.abilityPlan.points.length < 16;
        console.log(`${String(id).padStart(3)} ${a.heroName.padEnd(16)} finals/purchases ${a.finalItemIds.length}/${a.items.length}  hash ${hash}  deterministic=${same}${short ? '  SHORT' : ''}`);
        if (short) failures++;
      } else {
        console.log(`# ${a.heroName} (hero ${a.heroId}) — ${a.heroMatches} matches, win ${(a.heroWinRate * 100).toFixed(1)}%, budget ${a.budget} souls, generator ${a.generatorVersion}`);
        printBuild(a);
        console.log(`\nparams hash ${hashString(stableStringify(DEFAULT_PARAMS))}  build hash ${hash}  deterministic=${same}`);
      }
      if (!same) failures++;
    } catch (e) {
      failures++;
      console.error(`hero ${id}: ${(e as Error).stack ?? e}`);
    }
  }
  if (failures) process.exit(1);
}

void main();
