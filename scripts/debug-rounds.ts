/** Developer aid: shows the best candidates of every selection round. `npx tsx scripts/debug-rounds.ts <heroId>` */
import { loadHeroInputs, loadShared } from '../src/data/snapshots';
import { generateBuild } from '../src/generator';
import { nodeFetcher } from './lib/node-data';

const id = Number(process.argv[2] ?? 1);
const shared = await loadShared(nodeFetcher);
const inputs = await loadHeroInputs(nodeFetcher, shared, id);
let round = 0;
generateBuild(inputs, undefined, ({ phase, chosen, candidates }) => {
  round++;
  console.log(`\nround ${round} [${phase}] chose ${chosen.model.name} (${chosen.kind}) score ${chosen.score.toFixed(2)}`);
  const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, 8);
  for (const c of top) {
    const t = Object.fromEntries(c.terms.map((x) => [x.term.split(' ')[0], Number(x.value.toFixed(2))]));
    console.log(`   ${c.model.name.padEnd(24)} T${c.model.tier} ${c.model.slot.padEnd(8)} ${c.kind.padEnd(7)} net ${String(c.netCost).padStart(5)} score ${c.score.toFixed(2)} ${JSON.stringify(t)}`);
  }
});
