/** Developer aid: prints the score terms behind each pick. `npx tsx scripts/debug-terms.ts <heroId>` */
import { loadHeroInputs, loadShared } from '../src/data/snapshots';
import { generateBuild } from '../src/generator';
import { nodeFetcher } from './lib/node-data';

const id = Number(process.argv[2] ?? 1);
const shared = await loadShared(nodeFetcher);
const inputs = await loadHeroInputs(nodeFetcher, shared, id);
const build = generateBuild(inputs);
console.log(`\n== ${build.heroName}`);
for (const it of build.items) {
  if (it.terms.length === 0) continue;
  const t = Object.fromEntries(it.terms.map((x) => [x.term.split(' ')[0], Number(x.value.toFixed(2))]));
  console.log(`${it.name.padEnd(24)} ${it.phase.padEnd(5)} ${it.slot.padEnd(8)} score ${it.score.toFixed(2)}  ${JSON.stringify(t)}`);
}
