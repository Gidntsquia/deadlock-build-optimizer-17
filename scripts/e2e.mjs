#!/usr/bin/env node
/**
 * Browser acceptance test for the built app (`npm run e2e`).
 *
 *   1. Re-runs itself inside a network-less Linux namespace (`unshare -rn`, loopback only) when the machine allows it.
 *   2. Proves the network is down, runs `npm run build`, and serves `dist/` with `vite preview`.
 *   3. Drives headless Chromium at 390x844 (touch) and 1280x800 against the real snapshot data and checks the
 *      acceptance criteria that concern the page: builds, buy lists, shop images, ability order, item cards,
 *      core / not-core badges, agreement %, layout and tap targets.
 *
 * Expected values come from the snapshots in public/data (catalog, hero kits, image manifest, the reference player's
 * matches) and from the rule stated in the README, never from the app's own modules, so the test is an independent check.
 * It asserts behavior and data shape, not item names.
 *
 * Flags: --no-isolate     skip the network namespace (the browser still blocks every non-local request)
 *        --skip-build     serve the existing dist/ instead of rebuilding
 *        --heroes=N       sweep only the first N heroes (default: all)
 *        --max-items=N    cap the item-card sweep (default 400)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..');
const DATA = join(ROOT, 'public', 'data');
const PORT = Number(process.env.E2E_PORT ?? 4173);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const a = argv.find((x) => x.startsWith(`${name}=`));
  return a ? a.slice(name.length + 1) : fallback;
};

// ------------------------------------------------------------------ network namespace

function isolationAvailable() {
  if (process.platform !== 'linux' || flag('--no-isolate')) return false;
  return spawnSync('unshare', ['-rn', 'sh', '-c', 'ip link set lo up'], { stdio: 'ignore' }).status === 0;
}

if (!flag('--inner') && isolationAvailable()) {
  const r = spawnSync('unshare', ['-rn', 'sh', '-c', 'ip link set lo up && exec "$0" "$@"', process.execPath, SELF, '--inner', ...argv], { stdio: 'inherit', cwd: ROOT });
  process.exit(r.status ?? 1);
}

// ------------------------------------------------------------------ reporting

const results = [];
let group = '';
function section(name) {
  group = name;
  console.log(`\n${name}`);
}
function check(name, ok, detail = '') {
  results.push({ group, name, ok: !!ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}
const info = (msg) => console.log(`  INFO  ${msg}`);
const few = (list, n = 4) => (list.length <= n ? list.join('; ') : `${list.slice(0, n).join('; ')}; … ${list.length - n} more`);

// ------------------------------------------------------------------ expected data (snapshots, read directly)

const readJson = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const SLOT_LABEL = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' };
const catalog = readJson('catalog.json').items;
const byId = new Map(catalog.map((i) => [i.id, i]));
const manifest = readJson('img/manifest.json');
const heroes = [...readJson('heroes.json').heroes].sort((a, b) => a.id - b.id);
const heroKit = (id) => readJson(`heroes/${id}.json`);
const zerg = readJson('zergggy/purchases-infernus.json');
const INFERNUS = 1;

const shopImagePath = (item) => `data/${manifest[item.shop_image_webp]}`;

/** The README's rule, re-implemented: core = in >= 30% of sampled matches, wins count 1.5x, bought at any time. */
function referenceCore(matches) {
  const weight = (m) => (m.won ? 1.5 : 1);
  const total = matches.reduce((s, m) => s + weight(m), 0);
  const acc = new Map();
  for (const m of matches) {
    const first = new Map();
    for (const p of m.purchases) first.set(p.item_id, Math.min(first.get(p.item_id) ?? Infinity, p.bought_s));
    for (const [id, t] of first) {
      const e = acc.get(id) ?? { n: 0, w: 0, t: [] };
      e.n++;
      e.w += weight(m);
      e.t.push(t);
      acc.set(id, e);
    }
  }
  const median = (v) => {
    const s = [...v].sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const items = new Map();
  for (const [id, e] of acc) items.set(id, { id, n: e.n, core: e.w / total >= 0.3 - 1e-9, medianBuyS: median(e.t) });
  return { items, sample: matches.length };
}

/** agreement = 0.7 * F1(overlap) + 0.3 * order concordance of the shared items (README). */
function referenceAgreement(buildIds, ref) {
  const core = [...ref.items.values()].filter((i) => i.core);
  const coreSet = new Set(core.map((i) => i.id));
  const shared = buildIds.filter((id) => coreSet.has(id));
  const precision = buildIds.length ? shared.length / buildIds.length : 0;
  const recall = core.length ? shared.length / core.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  let pct = f1 * 100;
  if (shared.length >= 2) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < shared.length; i++) {
      for (let j = i + 1; j < shared.length; j++) {
        const a = ref.items.get(shared[i]).medianBuyS;
        const b = ref.items.get(shared[j]).medianBuyS;
        n++;
        s += a < b ? 1 : a === b ? 0.5 : 0;
      }
    }
    pct = (0.7 * f1 + 0.3 * (s / n)) * 100;
  }
  return Math.round(pct * 10) / 10;
}

/** What the item card must show for one catalog item. */
function expectedSections(item) {
  const byType = new Map();
  for (const s of item.tooltip_sections ?? []) {
    const type = s.section_type ?? 'passive';
    const e = byType.get(type) ?? { keys: new Set(), texts: [] };
    for (const a of s.section_attributes ?? []) {
      if (a.loc_string) e.texts.push(a.loc_string);
      for (const k of [...(a.properties ?? []), ...(a.important_properties ?? []), ...(a.elevated_properties ?? [])]) {
        const p = item.properties?.[k];
        if (p && p.value !== undefined && p.value !== null && p.value !== '') e.keys.add(k);
      }
    }
    byType.set(type, e);
  }
  return byType;
}

/** Shown value of a stat line against the catalog property: same number, the catalog's unit once, sign where asked. */
function valueErrors(key, p, shown) {
  const errs = [];
  const raw = String(p.value).trim();
  const num = /[-+]?\d*\.?\d+/.exec(raw)?.[0];
  if (num === undefined) {
    if (!shown.includes(raw)) errs.push(`${key}: "${shown}" lacks "${raw}"`);
    return errs;
  }
  if (!shown.includes(num.replace(/^[-+]/, ''))) errs.push(`${key}: "${shown}" lacks the number ${num}`);
  if (/\d\s*([a-zA-Z%]+)\s*\1(?![a-zA-Z])/.test(shown)) errs.push(`${key}: "${shown}" repeats its unit`);
  if ((p.prefix ?? '').includes('{s:sign}') && Number(num) > 0 && !shown.startsWith('+')) errs.push(`${key}: "${shown}" should carry a plus sign`);
  if (num.startsWith('-') && !shown.startsWith('-')) errs.push(`${key}: "${shown}" lost the minus sign of ${num}`);
  return errs;
}

// ------------------------------------------------------------------ code that runs inside the page

const inPage = {
  readBuild: () => {
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const panel = document.querySelector('[data-testid="build-panel"]');
    const rows = $$('[data-testid="item-row"]', panel).map((el) => {
      const phaseEl = el.closest('[data-testid^="phase-"]');
      const img = el.querySelector('img.item-img');
      const badge = el.querySelector('[data-testid="core-badge"]');
      return {
        id: Number(el.dataset.itemId),
        name: el.dataset.itemName,
        nameText: text(el.querySelector('.item-name')),
        role: el.dataset.role,
        cost: Number(el.dataset.cost),
        running: Number(el.dataset.running),
        phase: phaseEl ? phaseEl.dataset.testid.slice(6) : null,
        costText: text(el.querySelector('[data-testid="item-cost"]')),
        runningText: text(el.querySelector('[data-testid="item-running"]')),
        img: img ? { abs: img.src, w: img.naturalWidth } : null,
        badge: badge ? { status: badge.dataset.status, text: text(badge) } : null,
      };
    });
    return {
      hero: text(document.querySelector('[data-testid="hero-head"] h1')),
      buildId: panel?.dataset.build ?? null,
      name: text(panel?.querySelector('[data-testid="build-summary"] h2')),
      total: text(panel?.querySelector('[data-testid="build-total"]')),
      agreement: text(panel?.querySelector('[data-testid="agreement-pct"]')),
      phases: $$('[data-testid^="phase-"]', panel).map((el) => el.dataset.testid.slice(6)),
      rows,
      steps: $$('[data-testid="ability-step"]', panel).map((el) => ({ point: Number(el.dataset.point), ability: el.dataset.ability, kind: el.dataset.kind, tier: Number(el.dataset.tier), label: text(el.querySelector('.step-kind')) })),
      cards: $$('[data-testid="ability-card"]', panel).map((el) => el.dataset.ability),
      insight: !!panel?.querySelector('[data-testid="insight"]'),
      badgesShown: $$('[data-testid="core-badge"]', panel).length,
      failed: !!document.querySelector('[data-testid="hero-error"], [data-testid="render-error"], [data-testid="load-error"]'),
    };
  },

  readSheet: () => {
    const sheet = document.querySelector('[data-testid="item-sheet"]');
    if (!sheet) return null;
    const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const img = sheet.querySelector('img.detail-img');
    return {
      title: text(sheet.querySelector('.sheet-title')),
      label: sheet.getAttribute('aria-label'),
      img: img ? { abs: img.src, w: img.naturalWidth } : null,
      cost: text(sheet.querySelector('[data-testid="item-detail-cost"]')),
      tier: text(sheet.querySelector('[data-testid="item-tier"]')),
      slot: text(sheet.querySelector('[data-testid="item-slot"]')),
      sections: [...sheet.querySelectorAll('[data-testid^="section-"]')].map((el) => ({
        type: el.dataset.testid.slice(8),
        rich: [...el.querySelectorAll('.rich')].map(text),
        stats: [...el.querySelectorAll('[data-testid="stat-line"]')].map((l) => ({ prop: l.dataset.prop, label: text(l.querySelector('.sl-label')), value: text(l.querySelector('.sl-value')) })),
        rows: [...el.querySelectorAll('li.statline')].filter((l) => !l.dataset.testid).map((l) => ({ label: text(l.querySelector('.sl-label')), value: text(l.querySelector('.sl-value')) })),
      })),
      links: [...sheet.querySelectorAll('[data-testid="item-link"]')].map((l) => Number(l.dataset.itemId)),
      badge: sheet.querySelector('[data-testid="badge-box"] [data-testid="core-badge"]')?.dataset.status ?? null,
    };
  },

  plainText: (htmls) =>
    htmls.map((h) => {
      const d = new DOMParser().parseFromString(`<body>${h}</body>`, 'text/html');
      return (d.body.textContent ?? '').replace(/\s+/g, '');
    }),

  layout: ({ rootSel, minTap }) => {
    const root = (rootSel && document.querySelector(rootSel)) || document.body;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="tab"], [role="link"], [tabindex]:not([tabindex="-1"])';
    const describe = (el) => {
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
      return `${el.tagName.toLowerCase()}${cls}${label ? ` "${label}"` : ''}`;
    };
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      // screen-reader-only text is clipped to a 1px box on purpose; nobody sees it, so it cannot be cut off
      if (el.closest('.visually-hidden')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const overflow = [];
    const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (docW > W) overflow.push(`page is ${docW}px wide in a ${W}px viewport`);
    let ellipsis = 0;
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.right > W + 0.5 || r.left < -0.5) overflow.push(`${describe(el)} spans ${Math.round(r.left)}..${Math.round(r.right)}px`);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        if (cs.textOverflow === 'ellipsis') ellipsis++;
        else overflow.push(`${describe(el)} hides ${el.scrollWidth - el.clientWidth}px sideways`);
      }
    }
    const targets = [];
    let measured = 0;
    for (const el of root.querySelectorAll(INTERACTIVE)) {
      if (!visible(el)) continue;
      measured++;
      const before = el.getBoundingClientRect();
      if (before.width < minTap - 0.01 || before.height < minTap - 0.01) targets.push(`${describe(el)} is ${Math.round(before.width)}x${Math.round(before.height)}px`);
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 1), W - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 1), H - 1);
      const hit = document.elementFromPoint(x, y);
      if (!(hit && (hit === el || el.contains(hit)))) targets.push(`${describe(el)} is covered by ${hit ? describe(hit) : 'nothing'}`);
    }
    return { W, docW, overflow, targets, measured, ellipsis };
  },

  geometry: () => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { vw: document.documentElement.clientWidth, vh: window.innerHeight, scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), main: rect('main.app'), topbar: rect('.topbar-inner'), sheet: rect('[data-testid="item-sheet"]') };
  },
};

// ------------------------------------------------------------------ page helpers

const T = (id) => `[data-testid="${id}"]`;
const heroReady = (page, name) =>
  page.waitForFunction((n) => document.querySelector('[data-testid="hero-head"] h1')?.textContent === n && !!document.querySelector('[data-testid="build-panel"] [data-testid="item-row"]'), name, { timeout: 30000 });
const imagesReady = (page) => page.waitForFunction(() => [...document.images].filter((i) => i.loading !== 'lazy').every((i) => i.complete), null, { timeout: 15000 });
const buildShown = (page, id) => page.waitForFunction((b) => document.querySelector('[data-testid="build-panel"]')?.dataset.build === b, id, { timeout: 15000 });

async function pickHero(page, hero) {
  await page.locator(T('hero-button')).tap();
  await page.locator(T('hero-picker')).waitFor();
  await page.locator(T(`hero-option-${hero.id}`)).tap();
  await page.locator(T('hero-picker')).waitFor({ state: 'detached' });
  await heroReady(page, hero.name);
  await imagesReady(page);
}

/** Taps each build tab in turn and reads the build; `onBuild` runs while that build is on screen. */
async function readAllBuilds(page, onBuild = null) {
  const tabs = page.locator(T('build-tab'));
  const n = await tabs.count();
  const builds = [];
  for (let i = 0; i < n; i++) {
    const tab = tabs.nth(i);
    const id = await tab.getAttribute('data-build');
    await tab.tap();
    await buildShown(page, id);
    await imagesReady(page);
    const b = await page.evaluate(inPage.readBuild);
    b.tabText = (await tab.innerText()).replace(/\s+/g, ' ').trim();
    builds.push(b);
    if (onBuild) await onBuild(b, i);
  }
  return builds;
}

function shapeErrors(b, minRows = 12) {
  const e = [];
  if (b.rows.length < minRows) e.push(`only ${b.rows.length} purchases`);
  if (b.phases.join() !== 'early,mid,late') e.push(`phase groups are "${b.phases.join(',') || 'none'}"`);
  const rank = { early: 0, mid: 1, late: 2 };
  let prevRank = 0;
  let prevRunning = 0;
  for (const r of b.rows) {
    const it = byId.get(r.id);
    if (!it) {
      e.push(`${r.name}: item ${r.id} is not in the catalog`);
      continue;
    }
    if (r.phase === null || rank[r.phase] < prevRank) e.push(`${r.name}: out of phase order`);
    prevRank = Math.max(prevRank, rank[r.phase] ?? 0);
    if (r.nameText !== it.name) e.push(`${r.name}: shows the name "${r.nameText}"`);
    if (r.cost !== it.cost) e.push(`${r.name}: cost ${r.cost} differs from the catalog's ${it.cost}`);
    if (r.costText !== fmt(it.cost)) e.push(`${r.name}: shows cost "${r.costText}" instead of ${fmt(it.cost)}`);
    if (!(r.running > prevRunning)) e.push(`${r.name}: running total ${r.running} does not rise above ${prevRunning}`);
    if (r.running - prevRunning > it.cost) e.push(`${r.name}: adds ${r.running - prevRunning} souls, more than its price ${it.cost}`);
    if (r.runningText !== `total ${fmt(r.running)}`) e.push(`${r.name}: shows "${r.runningText}" for running total ${r.running}`);
    prevRunning = r.running;
    if (!it.shop_image_webp || !manifest[it.shop_image_webp]) e.push(`${r.name}: no local shop image in the snapshot`);
    else if (!r.img) e.push(`${r.name}: no image element (fallback tile shown)`);
    else {
      const path = decodeURIComponent(new URL(r.img.abs).pathname);
      if (!path.endsWith(`/${shopImagePath(it)}`)) e.push(`${r.name}: image ${path} is not its shop image ${shopImagePath(it)}`);
      if (!(r.img.w > 0)) e.push(`${r.name}: image did not load`);
    }
  }
  const last = b.rows[b.rows.length - 1];
  if (last && b.total !== fmt(last.running)) e.push(`summary total ${b.total} differs from the last running total ${fmt(last.running)}`);
  return e;
}

function abilityErrors(b, kit) {
  const e = [];
  const names = kit.abilities.filter((a) => /^signature[1-4]$/.test(a.slot)).map((a) => a.name);
  if (names.length !== 4) e.push(`the kit lists ${names.length} abilities`);
  if (b.steps.length !== 16) e.push(`${b.steps.length} ability points instead of 16`);
  if (b.steps.some((s, i) => s.point !== i + 1)) e.push('ability points are not numbered 1..16 in order');
  for (const s of b.steps) if (!names.includes(s.ability)) e.push(`point ${s.point} names "${s.ability}", not one of ${names.join(', ')}`);
  const unlockOrder = [];
  for (const name of names) {
    const mine = b.steps.filter((s) => s.ability === name);
    if (mine.map((s) => `${s.kind}${s.tier}`).join() !== 'unlock0,upgrade1,upgrade2,upgrade3') e.push(`${name}: sequence is ${mine.map((s) => `${s.kind}${s.tier}`).join(',') || 'missing'}`);
    if (mine.map((s) => s.label).join() !== 'Unlock,Upgrade 1,Upgrade 2,Upgrade 3') e.push(`${name}: labels are ${mine.map((s) => s.label).join(',')}`);
    if (mine.length && !mine.every((s, i) => i === 0 || s.point > mine[i - 1].point)) e.push(`${name}: tiers are not in rising order`);
    unlockOrder.push([name, mine[0]?.point ?? 99]);
  }
  if (new Set(b.cards).size !== 4 || !names.every((n) => b.cards.includes(n))) e.push(`ability cards are ${b.cards.join(', ')}`);
  return { errors: e, unlockOrder: unlockOrder.sort((a, z) => a[1] - z[1]).map((x) => x[0]) };
}

/** Compares the open item card with the catalog item. Returns a list of problems. */
async function cardErrors(page, item, opts = {}) {
  const e = [];
  const s = await page.evaluate(inPage.readSheet);
  if (!s) return ['card is not open'];
  if (s.title !== item.name) e.push(`title "${s.title}" instead of "${item.name}"`);
  if (s.label !== item.name) e.push(`dialog label "${s.label}"`);
  if (!item.shop_image_webp || !manifest[item.shop_image_webp]) e.push('no local shop image in the snapshot');
  else if (!s.img) e.push('no image element (fallback tile shown)');
  else {
    if (!decodeURIComponent(new URL(s.img.abs).pathname).endsWith(`/${shopImagePath(item)}`)) e.push(`image ${new URL(s.img.abs).pathname} is not ${shopImagePath(item)}`);
    if (!(s.img.w > 0)) e.push('image did not load');
  }
  if (s.cost !== `${fmt(item.cost)} souls`) e.push(`cost "${s.cost}" vs ${item.cost}`);
  if (s.tier !== `Tier ${item.item_tier}`) e.push(`tier "${s.tier}" vs ${item.item_tier}`);
  if (s.slot !== SLOT_LABEL[item.item_slot_type]) e.push(`slot "${s.slot}" vs ${item.item_slot_type}`);

  const want = expectedSections(item);
  const shown = new Map();
  for (const sec of s.sections) {
    const d = shown.get(sec.type) ?? { keys: new Set(), rich: [], stats: [] };
    sec.stats.forEach((l) => d.keys.add(l.prop));
    d.rich.push(...sec.rich);
    d.stats.push(...sec.stats);
    shown.set(sec.type, d);
  }
  for (const [type, w] of want) {
    const d = shown.get(type);
    if (!d) {
      e.push(`no ${type} section`);
      continue;
    }
    const missing = [...w.keys].filter((k) => !d.keys.has(k));
    const extra = [...d.keys].filter((k) => !w.keys.has(k));
    if (missing.length) e.push(`${type}: missing stat lines ${missing.join(', ')}`);
    if (extra.length) e.push(`${type}: unexpected stat lines ${extra.join(', ')}`);
    for (const l of d.stats) {
      const p = item.properties?.[l.prop];
      if (!p) continue;
      if (l.label !== (p.label ?? l.prop).trim()) e.push(`${l.prop}: label "${l.label}" vs "${p.label ?? l.prop}"`);
      e.push(...valueErrors(l.prop, p, l.value));
    }
    if (w.texts.length) {
      const plain = await page.evaluate(inPage.plainText, w.texts);
      const joined = d.rich.join('').replace(/\s+/g, '');
      plain.forEach((t, i) => {
        if (t && !joined.includes(t)) e.push(`${type} text ${i + 1} differs from the assets text`);
      });
    }
  }
  for (const type of shown.keys()) if (type !== 'description' && type !== 'build' && !want.has(type)) e.push(`unexpected ${type} section`);
  if ([...want.values()].every((w) => w.texts.length === 0)) {
    const texts = [item.description?.desc, item.description?.passive, item.description?.active].filter(Boolean);
    if (texts.length) {
      const plain = await page.evaluate(inPage.plainText, texts);
      const joined = (shown.get('description')?.rich ?? []).join('').replace(/\s+/g, '');
      plain.forEach((t, i) => {
        if (t && !joined.includes(t)) e.push(`description text ${i + 1} differs from the assets text`);
      });
    }
  }
  if (opts.row) {
    const build = s.sections.find((x) => x.type === 'build');
    const val = (label) => build?.rows.find((r) => r.label === label)?.value;
    if (!build) e.push('no "In this build" section');
    else {
      if (val('Price') !== fmt(opts.row.cost)) e.push(`price row "${val('Price')}"`);
      if (val('Running soul total') !== fmt(opts.row.running)) e.push(`running total row "${val('Running soul total')}"`);
    }
  }
  if (opts.badge !== undefined && s.badge !== opts.badge) e.push(`badge is ${s.badge}, expected ${opts.badge}`);
  return e;
}

async function closeWithEscape(page) {
  await page.keyboard.press('Escape');
  await page.locator(T('item-sheet')).waitFor({ state: 'detached', timeout: 5000 });
}

/** Card state shared by the checks: items whose card was compared with the catalog, chips seen, failures. */
const cards = { verified: new Set(), links: new Map(), failures: [] };

/** Opens the card for a build row, compares it, and closes it again with Escape. */
async function verifyRowCard(page, rowLocator, row, label) {
  await rowLocator.tap();
  await page.locator(T('item-sheet')).waitFor({ timeout: 5000 });
  const errs = await cardErrors(page, byId.get(row.id), { row });
  if (errs.length) cards.failures.push(`${label} / ${row.name}: ${few(errs, 3)}`);
  cards.verified.add(row.id);
  await closeWithEscape(page);
}

function pathToUnvisited(from) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const x = queue.shift();
    for (const y of cards.links.get(x) ?? []) {
      if (prev.has(y) || !byId.has(y)) continue;
      prev.set(y, x);
      if (!cards.verified.has(y)) {
        const path = [];
        for (let c = y; c !== from; c = prev.get(c)) path.unshift(c);
        return path;
      }
      queue.push(y);
    }
  }
  return null;
}

/** With a card open for `startId`, follows "Built from" / "Upgrades into" chips to every reachable unverified item. */
async function walkLinks(page, startId, budget) {
  let current = startId;
  let opened = 0;
  const note = async (id) => {
    const s = await page.evaluate(inPage.readSheet);
    cards.links.set(id, s.links);
    if (!cards.verified.has(id)) {
      const errs = await cardErrors(page, byId.get(id));
      if (errs.length) cards.failures.push(`${byId.get(id).name} (via links): ${few(errs, 3)}`);
      cards.verified.add(id);
      opened++;
    }
  };
  await note(current);
  while (cards.verified.size < budget) {
    const path = pathToUnvisited(current);
    if (!path) break;
    for (const hop of path) {
      await page.locator(`${T('item-sheet')} ${T('item-link')}[data-item-id="${hop}"]`).first().tap();
      await page.waitForFunction((name) => document.querySelector('[data-testid="item-sheet"] .sheet-title')?.textContent === name, byId.get(hop).name, { timeout: 5000 });
      current = hop;
      await note(hop);
    }
  }
  return opened;
}

// ------------------------------------------------------------------ main

const problems = [];
const external = [];
const isLocal = (url) => /^(http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/|data:|blob:|about:)/.test(url);

async function newContext(browser, options, { record = true } = {}) {
  const ctx = await browser.newContext(options);
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (isLocal(url)) return route.continue();
    if (record) external.push(url);
    return route.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  if (record) {
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err}`));
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
    });
  }
  return { ctx, page };
}

const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

const layoutRuns = [];
async function layoutPass(page, label, rootSel = null) {
  const res = await page.evaluate(inPage.layout, { rootSel, minTap: 40 });
  layoutRuns.push({ label, ...res });
  return res;
}

async function main() {
  let server = null;
  let browser = null;
  try {
    // ---------------------------------------------------------------- criterion 2: offline build
    section('Criterion 2 — build and serve with the network disabled');
    let isolated = false;
    try {
      const res = await fetch('https://api.deadlock-api.com/v1/info', { signal: AbortSignal.timeout(4000) });
      info(`network is reachable (HTTP ${res.status}); the browser still blocks every non-local request`);
    } catch (err) {
      isolated = true;
      check('network is unreachable from this process', true, String(err.cause?.code ?? err.message));
    }
    const snapshotsPresent = ['meta.json', 'catalog.json', 'heroes.json', 'zergggy/purchases-infernus.json'].every((f) => existsSync(join(DATA, f)));
    check('snapshots are present in public/data', snapshotsPresent);
    if (!flag('--skip-build')) {
      rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
      const t0 = Date.now();
      const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' } });
      check('npm run build succeeds', b.status === 0 && existsSync(join(ROOT, 'dist', 'index.html')), `${((Date.now() - t0) / 1000).toFixed(1)}s${b.status === 0 ? '' : `\n${(b.stdout + b.stderr).split('\n').slice(-25).join('\n')}`}`);
      if (b.status !== 0) return;
    } else info('--skip-build: serving the existing dist/');
    check('dist/ holds the snapshot data it needs', existsSync(join(ROOT, 'dist', 'data', 'meta.json')) && existsSync(join(ROOT, 'dist', 'data', 'img', 'manifest.json')));

    server = spawn(join(ROOT, 'node_modules', '.bin', 'vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverLog = '';
    server.stdout.on('data', (d) => (serverLog += d));
    server.stderr.on('data', (d) => (serverLog += d));
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        up = (await fetch(`${ORIGIN}/`)).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!check('vite preview serves dist/', up, up ? ORIGIN : serverLog.trim().slice(-400))) return;

    browser = await chromium.launch({ headless: true });

    // ---------------------------------------------------------------- Infernus, phone
    const { ctx: mctx, page } = await newContext(browser, MOBILE);
    await page.goto(`${ORIGIN}/`);
    await page.locator(T('build-panel')).waitFor({ timeout: 30000 });
    await heroReady(page, 'Infernus').catch(() => {});
    await imagesReady(page);
    check('the app renders (no load error)', (await page.locator(T('load-error')).count()) === 0 && (await page.locator(T('build-panel')).count()) === 1);

    section('Criterion 3 — opens on Infernus, ≥2 named builds, grouped buy lists, running totals, shop images');
    const firstHero = await page.locator(T('hero-name')).innerText();
    check('opens on Infernus', firstHero === 'Infernus', firstHero);
    const builds = await readAllBuilds(page);
    check('at least 2 builds, each with a distinct name', builds.length >= 2 && new Set(builds.map((b) => b.name)).size === builds.length && builds.every((b) => b.name), builds.map((b) => b.name).join(' | '));
    for (const b of builds) {
      const errs = shapeErrors(b);
      check(`${b.name}: ${b.rows.length} purchases in early/mid/late, catalog costs, rising running totals, correct shop images`, errs.length === 0, few(errs));
    }
    check('each build shows its phases as headed groups (early, mid, late)', builds.every((b) => b.phases.join() === 'early,mid,late'));
    check('phone tabs switch builds by tap and by arrow key', await (async () => {
      const tabs = page.locator(T('build-tab'));
      await tabs.nth(0).tap();
      await tabs.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      return (await tabs.nth(1).getAttribute('aria-selected')) === 'true' && (await tabs.nth(0).getAttribute('aria-selected')) === 'false';
    })());

    // ---------------------------------------------------------------- criterion 5: abilities
    section('Criterion 5 — ability level-up sequence with the 4 real Infernus ability names');
    const kit1 = heroKit(INFERNUS);
    const names1 = kit1.abilities.filter((a) => /^signature[1-4]$/.test(a.slot)).map((a) => a.name);
    check('the snapshot kit has 4 real ability names', names1.length === 4 && names1.every((n) => n && !/^(signature|ability|citadel)/i.test(n)), names1.join(', '));
    for (const b of builds) {
      const r = abilityErrors(b, kit1);
      check(`${b.name}: 16 points, unlock + upgrades 1-3 for ${names1.join(', ')}`, r.errors.length === 0, r.errors.length ? few(r.errors) : `unlock order ${r.unlockOrder.join(' → ')}`);
    }

    // ---------------------------------------------------------------- criterion 7: badges and agreement
    section('Criterion 7 — Zergggy core / not-core badges and agreement %');
    const ref = referenceCore(zerg.matches);
    const coreCount = [...ref.items.values()].filter((i) => i.core).length;
    for (const b of builds) {
      const errs = [];
      for (const r of b.rows) {
        const w = ref.items.get(r.id);
        const status = w ? (w.core ? 'core' : 'experiment') : 'unseen';
        const text = `${status === 'core' ? 'Core' : 'Not core'} · ${w?.n ?? 0}/${ref.sample}`;
        if (!r.badge) errs.push(`${r.name}: no badge`);
        else if (r.badge.status !== status || r.badge.text !== text) errs.push(`${r.name}: badge "${r.badge.text}" (${r.badge.status}), expected "${text}" (${status})`);
      }
      check(`${b.name}: every one of ${b.rows.length} purchases carries the right core / not-core badge`, errs.length === 0 && b.badgesShown === b.rows.length, few(errs));
      const shown = Number.parseFloat(b.agreement);
      const want = referenceAgreement(b.rows.map((r) => r.id), ref);
      check(`${b.name}: agreement ${b.agreement} matches 0.7·overlap + 0.3·order computed independently (${want}%)`, Number.isFinite(shown) && shown >= 0 && shown <= 100 && Math.abs(shown - want) < 0.06);
      check(`${b.name}: the tab shows its agreement`, /\d+% agreement/.test(b.tabText), b.tabText);
    }
    const panel = page.locator(T('validation-panel'));
    const panelText = (await panel.innerText()).replace(/\s+/g, ' ');
    check('validation panel states the 30% rule, experiments and held-out use', /30%/.test(panelText) && /experiment/i.test(panelText) && /not a source/i.test(panelText));
    const rowPcts = await page.locator(T('agreement-pct-row')).allInnerTexts();
    check('validation panel lists one agreement per build, equal to the build chips', rowPcts.length === builds.length && rowPcts.every((t, i) => t === builds[i].agreement), rowPcts.join(', '));
    await page.locator(T('toggle-core')).tap();
    const coreRows = await page.locator(T('core-row')).evaluateAll((els) => els.map((e) => Number(e.dataset.itemId)));
    check(`"core items" list has ${coreCount} items, all core by the independent rule`, coreRows.length === coreCount && coreRows.every((id) => ref.items.get(id)?.core), `${coreRows.length} listed`);
    await page.locator(T('toggle-experiments')).tap();
    const expRows = await page.locator(T('experiment-row')).evaluateAll((els) => els.map((e) => Number(e.dataset.itemId)));
    const expCount = [...ref.items.values()].filter((i) => !i.core).length;
    check(`"excluded experiments" list has ${expCount} items, none core`, expRows.length === expCount && expRows.every((id) => ref.items.get(id) && !ref.items.get(id).core), `${expRows.length} listed`);
    check('the Infernus page shows a personalization insight', builds.every((b) => b.insight));

    // ---------------------------------------------------------------- criterion 6: item cards
    section('Criterion 6 — item detail card matches the assets data');
    let rowCards = 0;
    for (let bi = 0; bi < builds.length; bi++) {
      await page.locator(T('build-tab')).nth(bi).tap();
      await buildShown(page, builds[bi].buildId);
      for (let i = 0; i < builds[bi].rows.length; i++) {
        const r = builds[bi].rows[i];
        const row = page.locator(`${T('build-panel')} ${T('item-row')}`).nth(i);
        await row.tap();
        await page.locator(T('item-sheet')).waitFor({ timeout: 5000 });
        const w = ref.items.get(r.id);
        const errs = await cardErrors(page, byId.get(r.id), { row: r, badge: w ? (w.core ? 'core' : 'experiment') : 'unseen' });
        rowCards++;
        if (errs.length) cards.failures.push(`${builds[bi].name} / ${r.name}: ${few(errs, 3)}`);
        cards.verified.add(r.id);
        await layoutPass(page, `item card: ${r.name}`, '[role="dialog"]');
        await closeWithEscape(page);
        const focused = await page.evaluate(() => document.activeElement?.dataset?.itemId ?? null);
        if (focused !== String(r.id)) cards.failures.push(`${r.name}: focus did not return to the row after Escape (${focused})`);
      }
    }
    check(`tapping each of the ${rowCards} build rows opens a card with image, cost, tier, slot, stats and effect text equal to the catalog, and Escape returns focus`, cards.failures.length === 0, few(cards.failures));

    // the card also opens from the validation lists; close by the button and by the backdrop
    const coreRow = page.locator(T('core-row')).first();
    await coreRow.tap();
    await page.locator(T('item-sheet')).waitFor();
    const coreId = Number(await coreRow.getAttribute('data-item-id'));
    const errsCore = await cardErrors(page, byId.get(coreId), { badge: 'core' });
    await page.locator(T('sheet-close')).tap();
    await page.locator(T('item-sheet')).waitFor({ state: 'detached' });
    const expRow = page.locator(T('experiment-row')).first();
    await expRow.tap();
    await page.locator(T('item-sheet')).waitFor();
    const expId = Number(await expRow.getAttribute('data-item-id'));
    const errsExp = await cardErrors(page, byId.get(expId), { badge: 'experiment' });
    await page.mouse.click(4, 4);
    const backdropClosed = await page.locator(T('item-sheet')).waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false);
    check('cards open from the validation lists, close with the X button and with a tap outside', errsCore.length === 0 && errsExp.length === 0 && backdropClosed, few([...errsCore, ...errsExp]));

    // the "Built from" / "Upgrades into" chips open the linked item's card; follow them from every Infernus row
    const failuresBeforeWalk = cards.failures.length;
    const verifiedBeforeWalk = cards.verified.size;
    const maxItems = Number(option('--max-items', 400));
    for (let bi = 0; bi < builds.length; bi++) {
      await page.locator(T('build-tab')).nth(bi).tap();
      await buildShown(page, builds[bi].buildId);
      for (let i = 0; i < builds[bi].rows.length; i++) {
        await page.locator(`${T('build-panel')} ${T('item-row')}`).nth(i).tap();
        await page.locator(T('item-sheet')).waitFor({ timeout: 5000 });
        await walkLinks(page, builds[bi].rows[i].id, maxItems);
        await page.keyboard.press('Escape');
        await page.locator(T('item-sheet')).waitFor({ state: 'detached' });
      }
    }
    const linkOpened = cards.verified.size - verifiedBeforeWalk;
    const chipsSeen = [...cards.links.values()].reduce((s, l) => s + l.length, 0);
    check(`link chips navigate between cards: ${linkOpened} more items reached through ${chipsSeen} chips, all matching the catalog`, cards.failures.length === failuresBeforeWalk && chipsSeen > 0, few(cards.failures.slice(failuresBeforeWalk)));

    // ---------------------------------------------------------------- criterion 9 (part): layout on the phone
    section('Criterion 9 — 390×844: no horizontal scrolling, every control ≥ 40px and tappable');
    for (let bi = 0; bi < builds.length; bi++) {
      await page.locator(T('build-tab')).nth(bi).tap();
      await buildShown(page, builds[bi].buildId);
      await layoutPass(page, `main screen, ${builds[bi].name}`);
    }
    // expand every <details> (ability upgrades, scoring table) and both validation lists
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    const coreToggle = page.locator(T('toggle-core'));
    if ((await page.locator(T('core-row')).count()) === 0) await coreToggle.tap();
    if ((await page.locator(T('experiment-row')).count()) === 0) await page.locator(T('toggle-experiments')).tap();
    await layoutPass(page, 'everything expanded (details, core list, experiments list)');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await layoutPass(page, 'page bottom (footer)');
    // hero picker, with and without a search result
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator(T('hero-button')).tap();
    await page.locator(T('hero-picker')).waitFor();
    await layoutPass(page, 'hero picker', '[role="dialog"]');
    await page.locator(T('hero-search')).fill('zzzz');
    await layoutPass(page, 'hero picker, no match', '[role="dialog"]');
    await page.locator(T('hero-search')).fill('inf');
    const matches = await page.locator('[data-testid^="hero-option-"]').evaluateAll((els) => els.map((e) => e.dataset.heroName));
    await page.locator(T('hero-search')).fill('');
    const allOptions = await page.locator('[data-testid^="hero-option-"]').count();
    section('Hero picker');
    check(`search narrows the list (${allOptions} heroes, "inf" gives ${matches.join(', ')})`, matches.includes('Infernus') && matches.length < allOptions && allOptions === heroes.length);
    await page.keyboard.press('Escape');
    await page.locator(T('hero-picker')).waitFor({ state: 'detached' });

    // ---------------------------------------------------------------- criterion 4: other heroes
    section('Criterion 4 — other heroes generate and render (buy list + ability order) without errors');
    const others = heroes.filter((h) => h.id !== INFERNUS);
    const spot = [others[0], others[Math.floor(others.length / 2)], others[others.length - 1]];
    for (const h of spot) {
      await pickHero(page, h);
      const hb = await readAllBuilds(page);
      const errs = [];
      hb.forEach((b) => {
        errs.push(...shapeErrors(b).map((x) => `${b.name}: ${x}`));
        errs.push(...abilityErrors(b, heroKit(h.id)).errors.map((x) => `${b.name}: ${x}`));
        if (b.failed) errs.push(`${b.name}: error state shown`);
      });
      check(`picker → ${h.name}: ${hb.length} builds, buy lists and 16-point ability orders`, hb.length >= 2 && errs.length === 0, few(errs));
      await layoutPass(page, `main screen, ${h.name}`);
    }
    const sweepHeroes = heroes.slice(0, Number(option('--heroes', heroes.length)));
    const heroFailures = [];
    let buildsSeen = 0;
    let purchases = 0;
    const cardFailuresBeforeSweep = cards.failures.length;
    const verifiedBeforeSweep = cards.verified.size;
    for (const h of sweepHeroes) {
      try {
        await pickHero(page, h);
        const hb = await readAllBuilds(page, async (b) => {
          for (let i = 0; i < b.rows.length; i++) {
            if (cards.verified.has(b.rows[i].id)) continue;
            await verifyRowCard(page, page.locator(`${T('build-panel')} ${T('item-row')}`).nth(i), b.rows[i], `${h.name} / ${b.name}`);
          }
        });
        if (hb.length < 2) heroFailures.push(`${h.name}: ${hb.length} builds`);
        hb.forEach((b) => {
          buildsSeen++;
          purchases += b.rows.length;
          const errs = [...shapeErrors(b), ...abilityErrors(b, heroKit(h.id)).errors];
          if (b.failed) errs.push('error state shown');
          if (h.id !== INFERNUS && b.badgesShown !== 0) errs.push('core badges shown without validation data');
          if (errs.length) heroFailures.push(`${h.name} / ${b.name}: ${few(errs, 3)}`);
        });
      } catch (err) {
        heroFailures.push(`${h.name}: ${String(err.message).split('\n')[0]}`);
      }
    }
    check(`all ${sweepHeroes.length} active heroes: ${buildsSeen} builds, ${purchases} purchases render with images, totals and 16 ability points`, heroFailures.length === 0, few(heroFailures));
    const shopable = catalog.filter((i) => i.shopable && !i.disabled);
    const reached = shopable.filter((i) => cards.verified.has(i.id)).length;
    section('Criterion 6 — item cards across every hero');
    check(`every item recommended in any build opens a matching card: ${cards.verified.size} distinct items checked (${cards.verified.size - verifiedBeforeSweep} more during the hero sweep; ${reached} of the ${shopable.length} shopable catalog items)`, cards.failures.length === cardFailuresBeforeSweep, few(cards.failures.slice(cardFailuresBeforeSweep)));
    section('Criterion 4 — other heroes (continued)');
    check('non-Infernus heroes say validation covers Infernus only', (await page.locator(T('validation-panel')).innerText()).includes('Infernus only'));

    // deep link, unknown id, persistence
    const seven = others[Math.floor(others.length / 3)];
    await page.goto(`${ORIGIN}/#hero=${seven.id}`);
    await page.reload();
    await heroReady(page, seven.name);
    check('the address #hero=<id> opens that hero, and reload keeps it', (await page.locator(T('hero-name')).innerText()) === seven.name);
    await page.goto(`${ORIGIN}/#hero=999999`);
    await page.reload();
    await heroReady(page, 'Infernus');
    check('an unknown hero id in the address falls back to Infernus', (await page.evaluate(() => location.hash)) === '#hero=1');

    // determinism in the browser: two fresh loads give the same lists
    await page.goto(`${ORIGIN}/#hero=1`);
    await page.reload();
    await heroReady(page, 'Infernus');
    await imagesReady(page);
    const again = await readAllBuilds(page);
    const sig = (bs) => JSON.stringify(bs.map((b) => [b.name, b.rows.map((r) => [r.id, r.cost, r.running, r.phase]), b.steps.map((s) => [s.ability, s.tier]), b.agreement]));
    check('reloading gives identical builds, ability orders and agreement numbers', sig(again) === sig(builds));

    // ---------------------------------------------------------------- load failure screen
    section('Failure handling — missing snapshot shows a readable message, not a blank page');
    {
      const { ctx, page: p } = await newContext(browser, MOBILE, { record: false });
      await ctx.route('**/data/meta.json', (route) => route.fulfill({ status: 404, body: 'missing' }));
      await p.goto(`${ORIGIN}/`);
      await p.locator(T('load-error')).waitFor({ timeout: 10000 });
      const msg = await p.locator(T('load-error')).innerText();
      const lay = await p.evaluate(inPage.layout, { rootSel: null, minTap: 40 });
      check('load error names the fix (npm run fetch-data) and fits 390px', /fetch-data/.test(msg) && lay.overflow.length === 0, few(lay.overflow));
      await ctx.close();
    }

    // ---------------------------------------------------------------- criterion 9: summary of the phone measurements
    section('Criterion 9 — results of the phone layout measurements');
    const overflowRuns = layoutRuns.filter((r) => r.overflow.length);
    check(`no horizontal scrolling or overflow on any of ${layoutRuns.length} measured screens (document width ≤ 390px, nothing outside 0..390px, nothing clipped sideways)`, overflowRuns.length === 0, few(overflowRuns.map((r) => `${r.label}: ${few(r.overflow, 2)}`), 3));
    const tapRuns = layoutRuns.filter((r) => r.targets.length);
    const measured = layoutRuns.reduce((s, r) => s + r.measured, 0);
    check(`all ${measured} interactive elements measured are ≥ 40×40px and not covered by anything`, tapRuns.length === 0, few(tapRuns.map((r) => `${r.label}: ${few(r.targets, 2)}`), 3));
    const ellipsis = layoutRuns.reduce((s, r) => s + r.ellipsis, 0);
    if (ellipsis) info(`${ellipsis} text elements are cut with an ellipsis (by design)`);
    await mctx.close();

    // narrower phones, information only
    for (const w of [360, 320]) {
      const { ctx, page: p } = await newContext(browser, { ...MOBILE, viewport: { width: w, height: 740 } });
      await p.goto(`${ORIGIN}/`);
      await heroReady(p, 'Infernus');
      await imagesReady(p);
      await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
      const lay = await p.evaluate(inPage.layout, { rootSel: null, minTap: 40 });
      info(`${w}px wide: ${lay.overflow.length === 0 ? 'no overflow' : `overflow — ${few(lay.overflow, 2)}`}; ${lay.targets.length === 0 ? 'all targets ok' : `targets — ${few(lay.targets, 2)}`}`);
      await ctx.close();
    }

    // ---------------------------------------------------------------- desktop
    section('Desktop 1280×800 — centered column');
    {
      const { ctx, page: p } = await newContext(browser, DESKTOP);
      await p.goto(`${ORIGIN}/`);
      await heroReady(p, 'Infernus');
      await imagesReady(p);
      const g = await p.evaluate(inPage.geometry);
      const centered = (r) => r && Math.abs((r.left + r.right) / 2 - g.vw / 2) <= 1.5;
      check('content column is centered and narrower than the window', centered(g.main) && g.main.width <= 600 && g.main.width < g.vw / 2, `column ${Math.round(g.main.width)}px in ${g.vw}px`);
      check('top bar content is centered on the same column', centered(g.topbar));
      check('no horizontal scrolling on desktop', g.scrollW <= g.vw, `${g.scrollW} vs ${g.vw}`);
      await p.locator(`${T('build-panel')} ${T('item-row')}`).first().click();
      await p.locator(T('item-sheet')).waitFor();
      const g2 = await p.evaluate(inPage.geometry);
      check('item card opens centered and fully inside the window', centered(g2.sheet) && g2.sheet.top >= 0 && g2.sheet.bottom <= g2.vh + 0.5, g2.sheet ? `${Math.round(g2.sheet.width)}×${Math.round(g2.sheet.height)}px` : 'no card');
      await p.keyboard.press('Escape');
      await ctx.close();
    }

    // ---------------------------------------------------------------- hygiene
    section('Whole session — no console errors, no failed requests, nothing left the machine');
    check('no console errors or warnings, page errors, failed requests or HTTP errors', problems.length === 0, few(problems, 6));
    check('the app made no request to any non-local host', external.length === 0, few(external, 4));
    if (!isolated) info('the network was not disabled at the OS level in this run (rerun on Linux with unshare to get that proof)');
  } finally {
    await browser?.close().catch(() => {});
    server?.kill('SIGTERM');
  }
}

try {
  await main();
} catch (err) {
  check('the test run itself completed', false, String(err?.stack ?? err).split('\n').slice(0, 6).join('\n'));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `, ${failed.length} failed:` : '.'}`);
for (const f of failed) console.log(`  FAIL  [${f.group}] ${f.name}`);
process.exit(failed.length ? 1 : 0);
