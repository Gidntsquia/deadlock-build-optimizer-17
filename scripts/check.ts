/**
 * Acceptance checks that need no browser (the browser checks are in scripts/e2e.mjs).
 *
 *   npm run check                  snapshots, image files, generator isolation, determinism, documentation
 *   npm run check -- --live        also compares the catalog snapshot with the live assets API
 *   npm run check -- --write-docs  rewrites the generated parameter tables in README.md, then checks
 *
 * Exit code 1 when a check fails. A "gap" is a shortfall against the brief that comes from the data, not from the code;
 * it is printed in full and does not fail the run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { itemImage, localImage, type ImageManifest } from '../src/data/assets';
import { loadHeroInputs, loadShared, type JsonFetcher } from '../src/data/snapshots';
import { DEFAULT_PARAMS, generateBuild, hashBuild } from '../src/generator';
import { hashString, stableStringify } from '../src/generator/util';
import type { Build, CatalogItem, HeroKit } from '../src/types';
import type { ValidationSnapshot } from '../src/validation';
import { DATA_DIR, ROOT, nodeFetcher } from './lib/node-data';
import { DOCS_BEGIN, DOCS_END, renderParamDocs, withParamDocs } from './lib/param-docs';

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const WRITE_DOCS = args.has('--write-docs');

/** The brief asks for these; the gap is reported when the API offers fewer. */
const SPEC_MIN_SHOPABLE = 200;
const SPEC_MIN_ZERGGGY_MATCHES = 20;
const SPEC_MIN_FINAL_ITEMS = 12;
const VALIDATION_ACCOUNT = 35187362;

// ------------------------------------------------------------------ tiny test harness

type Status = 'pass' | 'fail' | 'gap';
const results: { title: string; status: Status; detail: string }[] = [];

class Gap extends Error {}

async function check(title: string, fn: () => Promise<string> | string): Promise<void> {
  try {
    results.push({ title, status: 'pass', detail: await fn() });
  } catch (e) {
    if (e instanceof Gap) results.push({ title, status: 'gap', detail: e.message });
    else results.push({ title, status: 'fail', detail: e instanceof Error ? e.message : String(e) });
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(DATA_DIR, rel), 'utf8')) as T;

/** A fetcher that refuses the validation snapshot: everything the generator reads goes through it. */
const requested: string[] = [];
const guardedFetcher: JsonFetcher = async (path) => {
  requested.push(path);
  if (/zergggy/i.test(path)) throw new Error(`the generator tried to read "${path}"`);
  return nodeFetcher(path);
};

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out.sort();
}
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/');

// ------------------------------------------------------------------ 1. snapshots

const shared = await loadShared(nodeFetcher);
const catalog = shared.catalog;
const shopable = catalog.filter((c) => c.shopable);
const heroes = shared.heroes;
const manifest = readJson<ImageManifest>('img/manifest.json');

await check('catalog snapshot: items and shopable items', () => {
  assert(catalog.length > 0, 'catalog.json has no items');
  assert(shopable.length >= 100, `only ${shopable.length} shopable items: the catalog download looks truncated`);
  assert(shared.meta.counts.catalogItems === catalog.length && shared.meta.counts.shopableItems === shopable.length, 'meta.json counts do not match catalog.json');
  const ids = new Set(catalog.map((c) => c.id));
  assert(ids.size === catalog.length, 'duplicate item ids in the catalog');
  const fields = shopable.filter((c) => !c.name || !(c.cost > 0) || !(c.item_tier >= 1 && c.item_tier <= 5) || !['weapon', 'vitality', 'spirit'].includes(c.item_slot_type));
  assert(fields.length === 0, `${fields.length} shopable items lack a name, cost, tier 1-5 or slot type (first: ${fields[0]?.class_name})`);
  const detail = `${catalog.length} catalog items, ${shopable.length} flagged shopable`;
  if (shopable.length < SPEC_MIN_SHOPABLE) {
    throw new Gap(`${detail}. The brief asks for at least ${SPEC_MIN_SHOPABLE} shopable items; the API lists ${shopable.length}, so that number cannot be met with real data (see README, "Judgment calls").`);
  }
  return detail;
});

await check('per-hero analytics for every active hero', () => {
  assert(heroes.length > 0 && heroes.length === shared.meta.counts.heroes, 'heroes.json does not match meta.json');
  const problems: string[] = [];
  let itemRows = 0;
  for (const h of heroes) {
    const files = [`heroes/${h.id}.json`, `analytics/item-stats-${h.id}.json`, `analytics/ability-order-${h.id}.json`, `analytics/permutation-stats-${h.id}.json`];
    for (const f of files) if (!existsSync(join(DATA_DIR, f))) problems.push(`${h.name}: missing ${f}`);
    if (problems.length) continue;
    const stats = readJson<{ rows: unknown[] }>(files[1]);
    const order = readJson<{ rows: unknown[]; abilityIds: number[] }>(files[2]);
    const perms = readJson<{ rows: unknown[] }>(files[3]);
    const kit = readJson<HeroKit>(files[0]);
    if (stats.rows.length < 30) problems.push(`${h.name}: only ${stats.rows.length} item-stats rows`);
    if (order.rows.length < 1) problems.push(`${h.name}: no ability-order rows`);
    if (perms.rows.length < 1) problems.push(`${h.name}: no permutation rows`);
    if (kit.abilities.length !== 4) problems.push(`${h.name}: ${kit.abilities.length} abilities in the kit`);
    itemRows += stats.rows.length;
  }
  assert(problems.length === 0, problems.slice(0, 5).join('; '));
  assert(existsSync(join(DATA_DIR, 'analytics/hero-stats.json')), 'analytics/hero-stats.json missing');
  return `${heroes.length} heroes, each with kit, item-stats, ability-order and permutation snapshots (${itemRows.toLocaleString('en-US')} item-stat rows)`;
});

await check('validation player snapshot: >= 20 real matches with purchases', () => {
  const v = readJson<ValidationSnapshot>('zergggy/purchases-infernus.json');
  assert(v.account_id === VALIDATION_ACCOUNT, `account ${v.account_id}, expected ${VALIDATION_ACCOUNT}`);
  assert(v.hero_id === 1, `hero ${v.hero_id}, expected Infernus (1)`);
  assert(v.matches.length >= SPEC_MIN_ZERGGGY_MATCHES, `only ${v.matches.length} matches`);
  const ids = new Set(catalog.map((c) => c.id));
  for (const m of v.matches) {
    assert(m.match_mode === 1 || m.match_mode === 4, `match ${m.match_id} has match_mode ${m.match_mode} (only Unranked 1 and Ranked 4 are real matchmaking)`);
    assert(m.purchases.length >= 10, `match ${m.match_id} has only ${m.purchases.length} purchases`);
    for (const p of m.purchases) assert(ids.has(p.item_id), `match ${m.match_id}: item ${p.item_id} is not in the catalog`);
  }
  assert(new Set(v.matches.map((m) => m.match_id)).size === v.matches.length, 'duplicate match ids');
  const history = readJson<{ selected: { match_id: number; game_mode: number; match_mode: number }[]; candidateMatches: number; skipped: unknown[] }>('zergggy/match-history-infernus.json');
  assert(history.selected.length === v.matches.length, 'match-history-infernus.json and purchases-infernus.json list different matches');
  assert(history.selected.every((m) => m.game_mode === 1 && (m.match_mode === 1 || m.match_mode === 4)), 'the selected matches are not all real matchmaking games');
  const wins = v.matches.filter((m) => m.won).length;
  const purchases = v.matches.reduce((s, m) => s + m.purchases.length, 0);
  return `${v.matches.length} matches (${wins} won, modes ${[...new Set(v.matches.map((m) => m.match_mode))].sort().join('/')}), ${purchases} purchase records, match list has ${history.candidateMatches} candidate Infernus matchmaking games`;
});

// ------------------------------------------------------------------ 2. images are local, present and real

await check('images: shop image for every shopable item, hero cards, ability icons (local files)', () => {
  const files: string[] = [];
  const missing: string[] = [];
  const test = (what: string, remote: string | undefined): void => {
    const local = localImage(manifest, remote, '/');
    if (!local) {
      missing.push(`${what}: not in manifest`);
      return;
    }
    const p = join(DATA_DIR, local.replace(/^\/data\//, ''));
    const buf = existsSync(p) ? readFileSync(p).subarray(0, 12) : null;
    const webp = buf && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
    const png = buf && buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG';
    if (!webp && !png) missing.push(`${what}: ${local} is missing or not an image`);
    else files.push(p);
  };
  for (const it of shopable) {
    const picked = itemImage(manifest, it);
    if (!picked) missing.push(`${it.name}: no image`);
    else test(it.name, it.shop_image_webp && manifest[it.shop_image_webp] ? it.shop_image_webp : it.shop_image);
  }
  for (const h of heroes) {
    test(`${h.name} card`, h.images.icon_hero_card_webp ?? h.images.icon_image_small_webp);
    for (const a of readJson<HeroKit>(`heroes/${h.id}.json`).abilities) test(`${h.name}: ${a.name}`, a.image_webp ?? a.image);
  }
  assert(missing.length === 0, `${missing.length} problems: ${missing.slice(0, 4).join('; ')}`);
  const shop = shopable.filter((it) => it.shop_image_webp && manifest[it.shop_image_webp]).length;
  return `${files.length} image files checked (${shop}/${shopable.length} shop images in WebP), all real image data`;
});

// ------------------------------------------------------------------ 3. generator isolation

const GENERATOR_ENTRY = join(ROOT, 'src', 'generator', 'index.ts');
const LOADER = join(ROOT, 'src', 'data', 'snapshots.ts');

function importsOf(file: string): string[] {
  const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  return info.importedFiles.map((i) => i.fileName);
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Every project file the generator can reach through imports. */
function reachable(entries: string[]): { files: string[]; packages: Set<string> } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(f)) {
      const target = resolveImport(f, spec);
      if (target) queue.push(target);
      else if (!spec.startsWith('.')) packages.add(spec);
    }
  }
  return { files: [...seen].sort(), packages };
}

await check('generator never reads the validation snapshot', async () => {
  const { files, packages } = reachable([GENERATOR_ENTRY, LOADER]);
  const validationFiles = files.filter((f) => /[\\/]src[\\/]validation[\\/]/.test(f));
  assert(validationFiles.length === 0, `generator imports reach ${validationFiles.map(rel).join(', ')}`);
  assert(packages.size === 0, `generator imports reach npm packages: ${[...packages].join(', ')}`);
  const offenders = files.filter((f) => /zergggy|35187362|purchases-infernus/i.test(readFileSync(f, 'utf8')));
  assert(offenders.length === 0, `these generator-reachable files mention the validation data: ${offenders.map(rel).join(', ')}`);
  const scripts = ['scripts/generate.ts', 'scripts/lib/node-data.ts'].map((p) => join(ROOT, p));
  const scriptOffenders = scripts.filter((f) => /zergggy|35187362|purchases-infernus/i.test(readFileSync(f, 'utf8')));
  assert(scriptOffenders.length === 0, `generation scripts mention the validation data: ${scriptOffenders.map(rel).join(', ')}`);

  // the only files that name the validation snapshot
  const holders = [...walk(join(ROOT, 'src'), ['.ts', '.tsx']), ...walk(join(ROOT, 'scripts'), ['.ts', '.mjs'])]
    .filter((f) => /zergggy\/purchases|VALIDATION_FILE/.test(readFileSync(f, 'utf8')))
    .map(rel)
    // the two verifiers read the raw snapshot on purpose: they recompute the validation independently of the app
    .filter((f) => f !== 'scripts/check.ts' && f !== 'scripts/e2e.mjs');
  const allowed = ['src/validation/index.ts', 'scripts/fetch-data.mjs'];
  const extra = holders.filter((f) => !allowed.includes(f));
  assert(extra.length === 0, `unexpected readers of the validation file: ${extra.join(', ')}`);

  // runtime proof: generate every hero with a fetcher that throws on the validation path
  requested.length = 0;
  const guardedShared = await loadShared(guardedFetcher);
  for (const h of heroes) generateBuild(await loadHeroInputs(guardedFetcher, guardedShared, h.id));
  const paths = [...new Set(requested.map((p) => p.replace(/\d+(?=\.json$)/, '<hero>')))].sort();
  assert(!paths.some((p) => /zergggy/i.test(p)), 'the generator requested a validation path');
  return `${files.length} generator modules import only each other and src/types.ts; data read at run time: ${paths.join(', ')}; the validation file is named only in ${holders.join(' and ')}`;
});

// ------------------------------------------------------------------ 4. generator output shape + determinism

function checkBuild(b: Build, byId: Map<number, CatalogItem>, kit: HeroKit): void {
  const who = b.heroName;
  assert(b.finalItemIds.length >= SPEC_MIN_FINAL_ITEMS, `${who}: ${b.finalItemIds.length} final items`);
  assert(b.totalCost <= b.budget * (1 + DEFAULT_PARAMS.fallback.budgetSlack), `${who}: ${b.totalCost} souls is over the budget of ${b.budget}`);
  const order = ['early', 'mid', 'late'];
  let last = -1;
  let running = 0;
  for (const it of b.items) {
    const c = byId.get(it.itemId);
    assert(c && c.shopable, `${who}: item ${it.itemId} is not a shopable catalog item`);
    assert(it.cost === c.cost && it.tier === c.item_tier && it.slot === c.item_slot_type, `${who}: ${it.name} differs from the catalog`);
    const ph = order.indexOf(it.phase);
    assert(ph >= last, `${who}: ${it.name} is out of phase order`);
    last = ph;
    running += it.netCost;
    assert(it.running === running, `${who}: running total at ${it.name} is ${it.running}, expected ${running}`);
    assert(it.netCost <= it.cost, `${who}: ${it.name} pays more than its price`);
  }
  assert(running === b.totalCost, `${who}: totalCost ${b.totalCost} != ${running}`);
  for (const ph of order) assert(b.items.some((i) => i.phase === ph), `${who}: no ${ph} purchases`);
  assert(new Set(b.finalItemIds).size === b.finalItemIds.length, `${who}: duplicate final items`);

  const points = b.abilityPlan.points;
  assert(points.length === 16, `${who}: ${points.length} ability points`);
  const names = new Set(kit.abilities.map((a) => a.name));
  assert(names.size === 4 && points.every((p) => names.has(p.abilityName)), `${who}: ability names are not the hero's four`);
  for (const a of kit.abilities) {
    const mine = points.filter((p) => p.abilityId === a.id);
    assert(mine.length === 4 && mine[0].kind === 'unlock' && mine.slice(1).map((p) => p.tier).join() === '1,2,3', `${who}: ${a.name} is not unlock + tiers 1, 2, 3 in order`);
  }
  assert(points.every((p, i) => p.point === i + 1), `${who}: points are not numbered 1..16`);
}

await check('generator output: one build, buy list and ability order for every hero', async () => {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  let items = 0;
  for (const h of heroes) {
    const inputs = await loadHeroInputs(guardedFetcher, shared, h.id);
    const build = generateBuild(inputs);
    checkBuild(build, byId, inputs.kit);
    items += build.items.length;
  }
  const inf = generateBuild(await loadHeroInputs(guardedFetcher, shared, 1));
  return `${heroes.length} heroes, one build each, ${items} purchases; Infernus: ${inf.finalItemIds.length} items / ${inf.totalCost} souls`;
});

await check('determinism: same snapshot, identical build (in-process and across processes)', async () => {
  const hashes: string[] = [];
  for (const h of heroes) {
    const inputs = await loadHeroInputs(guardedFetcher, shared, h.id);
    const a = generateBuild(inputs);
    const b = generateBuild(await loadHeroInputs(guardedFetcher, shared, h.id));
    assert(JSON.stringify(a) === JSON.stringify(b) && hashBuild(a) === hashBuild(b), `${h.name}: two runs differ`);
    hashes.push(hashBuild(a));
  }
  const run = (): string =>
    execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', 'generate.ts'), '--all', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 29 });
  const first = run();
  const second = run();
  assert(first.length > 100_000 && first === second, 'two separate generator processes printed different builds');
  const inf = hashBuild(generateBuild(await loadHeroInputs(guardedFetcher, shared, 1)));
  return `${heroes.length} heroes identical twice in one process and across two processes (${(first.length / 1e6).toFixed(1)} MB of JSON compared); Infernus build hash ${inf}, params hash ${hashString(stableStringify(DEFAULT_PARAMS))}`;
});

// ------------------------------------------------------------------ 5. README

await check('README: run steps, scoring inputs and weights, >= 30% core rule', () => {
  const p = join(ROOT, 'README.md');
  assert(existsSync(p), 'README.md is missing');
  let text = readFileSync(p, 'utf8');
  const block = renderParamDocs();
  if (WRITE_DOCS) {
    text = withParamDocs(text, block);
    writeFileSync(p, text);
  }
  const a = text.indexOf(DOCS_BEGIN);
  const b = text.indexOf(DOCS_END);
  assert(a >= 0 && b > a, 'README has no generated parameter block');
  assert(text.slice(a + DOCS_BEGIN.length, b).trim() === block.trim(), 'the parameter tables in README.md are out of date: run `npm run check -- --write-docs`');
  for (const need of ['npm install', 'npm run fetch-data', 'npm run dev', 'npm run build']) assert(text.includes(need), `README never mentions "${need}"`);
  assert(/30\s?%/.test(text) && /experiment/i.test(text) && /core/i.test(text), 'README does not state the 30% core rule with experiments excluded');
  assert(/agreement/i.test(text) && /held-out|held out/i.test(text), 'README does not explain agreement and the held-out rule');
  assert(/deterministic/i.test(text), 'README does not discuss determinism');
  return `parameter tables match DEFAULT_PARAMS (${block.split('\n').filter((l) => l.startsWith('| `')).length} rows); commands, core rule and determinism are documented`;
});

// ------------------------------------------------------------------ 6. optional: compare with the live assets API

if (LIVE) {
  await check('catalog snapshot matches the live assets API (cost, tier, slot, stats, descriptions)', async () => {
    const res = await fetch(`${shared.meta.api}/v1/assets/items/by-type/upgrade`, { headers: { accept: 'application/json' } });
    assert(res.ok, `live API answered HTTP ${res.status}`);
    const live = (await res.json()) as Record<string, unknown>[];
    const liveById = new Map(live.map((i) => [i.id as number, i]));
    const stripSvg = (s: unknown): unknown => (typeof s === 'string' ? s.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\s+\n/g, '\n') : s);
    const diffs: string[] = [];
    let fields = 0;
    for (const c of catalog) {
      const l = liveById.get(c.id);
      if (!l) {
        diffs.push(`${c.name}: gone from the API`);
        continue;
      }
      const same = (what: string, a: unknown, b: unknown): void => {
        fields++;
        if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${c.name}.${what}: snapshot ${JSON.stringify(a)} vs live ${JSON.stringify(b)}`);
      };
      same('cost', c.cost, l.cost);
      same('tier', c.item_tier, l.item_tier);
      same('slot', c.item_slot_type, l.item_slot_type);
      same('shopable', c.shopable, l.shopable === true);
      const props = (l.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [k, p] of Object.entries(c.properties)) {
        same(`${k}.value`, p.value ?? null, props[k]?.value ?? null);
        same(`${k}.label`, p.label ?? null, props[k]?.label ?? null);
      }
      const desc = (l.description ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(c.description ?? {})) same(`description.${k}`, v, stripSvg(desc[k]));
    }
    const liveShopable = live.filter((i) => i.shopable === true).length;
    assert(diffs.length === 0, `${diffs.length} differences (first: ${diffs.slice(0, 3).join(' | ')}); the game may have been patched since the snapshot: run npm run fetch-data`);
    return `${catalog.length} items, ${fields} fields identical to the live API (live: ${live.length} upgrade items, ${liveShopable} shopable)`;
  });
}

// ------------------------------------------------------------------ report

const mark: Record<Status, string> = { pass: 'PASS', fail: 'FAIL', gap: 'GAP ' };
for (const r of results) console.log(`${mark[r.status]}  ${r.title}\n      ${r.detail}`);
const failed = results.filter((r) => r.status === 'fail').length;
const gaps = results.filter((r) => r.status === 'gap').length;
console.log(`\n${results.length - failed - gaps} passed, ${failed} failed, ${gaps} known gap${gaps === 1 ? '' : 's'}${LIVE ? '' : ' (run with --live to compare against the live API)'}`);
process.exit(failed ? 1 : 0);
