/** Developer aid: lists a hero's candidate items with evidence. `npx tsx scripts/debug-items.ts <heroId> [minPickPct]` */
import { loadHeroInputs, loadShared } from '../src/data/snapshots';
import { computeEvidence } from '../src/generator/evidence';
import { DEFAULT_PARAMS } from '../src/generator/params';
import { nodeFetcher } from './lib/node-data';

const id = Number(process.argv[2] ?? 1);
const minPick = Number(process.argv[3] ?? 4) / 100;
const shared = await loadShared(nodeFetcher);
const inputs = await loadHeroInputs(nodeFetcher, shared, id);
const hs = inputs.heroStats;
const ev = computeEvidence(inputs.itemStats.rows, hs.matches, hs.wins / hs.matches, DEFAULT_PARAMS);
const byId = new Map(inputs.catalog.map((c) => [c.id, c]));
const rows = [...ev.values()]
  .filter((e) => e.pickRate >= minPick && byId.get(e.itemId)?.shopable)
  .sort((a, b) => (byId.get(a.itemId)!.item_slot_type < byId.get(b.itemId)!.item_slot_type ? -1 : byId.get(a.itemId)!.item_slot_type > byId.get(b.itemId)!.item_slot_type ? 1 : 0) || byId.get(a.itemId)!.item_tier - byId.get(b.itemId)!.item_tier || b.pickRate - a.pickRate);
for (const e of rows) {
  const c = byId.get(e.itemId)!;
  console.log(
    `${c.item_slot_type.padEnd(8)} T${c.item_tier} ${c.name.padEnd(24)} cost ${String(c.cost).padStart(5)} pick ${(e.pickRate * 100).toFixed(0).padStart(3)}%  wr ${(e.winRate * 100).toFixed(1)}%  lift ${(e.winLift * 100).toFixed(1).padStart(5)}  buy ${Math.round(e.avgBuyTimeS ?? 0)}s  comps ${c.component_items.join(',')}`,
  );
}
