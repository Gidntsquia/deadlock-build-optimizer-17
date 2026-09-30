#!/usr/bin/env node
/**
 * Snapshots Deadlock API data into public/data/*.json. The app only ever reads these files.
 *
 *   npm run fetch-data                          everything
 *   npm run fetch-data -- --skip-zergggy        everything except the validation data
 *   npm run fetch-data -- --zergggy-only        only the validation data (needs catalog.json)
 *   npm run fetch-data -- --heroes=1,2,3        limit the per-hero downloads (debugging)
 *   npm run fetch-data -- --resume              keep per-hero files that already exist
 *   npm run fetch-data -- --min-badge=70        rank floor for the aggregate analytics
 *   npm run fetch-data -- --matches=30          how many of the validation player's matches to read
 *
 * Node 20.19+ (global fetch). Requests are paced (~2/s) and retried on 429/5xx, well inside the
 * API's shared 200 requests/minute limit.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.deadlock-api.com';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');

// Accounts named in the project brief.
const USER_ACCOUNT_ID = 267836488; // personalization
const VALIDATION_ACCOUNT_ID = 35187362; // held-out validation only (Zergggy)
const VALIDATION_HERO_ID = 1; // Infernus

const DAY = 86400;
const REAL_MATCH_MODES = new Set([1, 4]); // 1 = Unranked, 4 = Ranked (2 private, 3 coop bot, 5 server test, ...)
const NORMAL_GAME_MODE = 1; // 1 = normal, 4 = street brawl

// ---------------------------------------------------------------- CLI

const flags = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return m ? [m[1], m[2] ?? true] : [arg, true];
  }),
);
const cfg = {
  skipZergggy: flags['skip-zergggy'] === true,
  zergggyOnly: flags['zergggy-only'] === true,
  resume: flags.resume === true,
  minBadge: Number(flags['min-badge'] ?? 70),
  matchCount: Number(flags.matches ?? 30),
  heroFilter: flags.heroes ? String(flags.heroes).split(',').map(Number) : null,
  gapMs: Number(flags['gap-ms'] ?? 450),
};

// ---------------------------------------------------------------- HTTP

let lastRequestAt = 0;
let requestCount = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { allow404 = false, retries = 6 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const wait = Math.max(0, lastRequestAt + cfg.gapMs - Date.now());
    if (wait) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount++;
    let res;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'deadlock-build-optimizer/1.0 (snapshot script)' },
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      if (attempt >= retries) throw new Error(`network error for ${url}: ${err.message}`);
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404 && allow404) return null;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(`HTTP ${res.status} for ${url}: ${body}`);
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
    console.log(`  ${res.status} from ${new URL(url).pathname}, retrying in ${(delay / 1000).toFixed(1)}s`);
    await sleep(delay);
  }
}

const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

// ---------------------------------------------------------------- files

async function writeJson(rel, value, { pretty = false } = {}) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, pretty ? 2 : 0) + '\n');
  return file;
}

async function readJsonIfExists(rel) {
  const file = path.join(OUT, rel);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- trimming helpers

const stripSvg = (html) => (typeof html === 'string' ? html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\s+\n/g, '\n') : html);
const mapStrings = (obj) =>
  obj && typeof obj === 'object' && !Array.isArray(obj)
    ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, stripSvg(v)]))
    : obj;
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));
const isZeroish = (v) => v === undefined || v === null || v === '' || Number.parseFloat(v) === 0;

const PROP_KEYS = ['value', 'label', 'prefix', 'postfix', 'css_class', 'display_units', 'negative_attribute', 'loc_token_override'];

function trimItem(item) {
  const referenced = new Set();
  const sections = (item.tooltip_sections ?? []).map((section) => ({
    ...section,
    section_attributes: (section.section_attributes ?? []).map((attr) => {
      for (const n of [...(attr.properties ?? []), ...(attr.elevated_properties ?? []), ...(attr.important_properties ?? [])]) referenced.add(n);
      return { ...attr, loc_string: stripSvg(attr.loc_string) };
    }),
  }));
  const properties = {};
  for (const name of referenced) {
    if (item.properties?.[name]) properties[name] = pick(item.properties[name], PROP_KEYS);
  }
  return {
    id: item.id,
    class_name: item.class_name,
    name: item.name,
    type: item.type,
    item_slot_type: item.item_slot_type,
    item_tier: item.item_tier,
    cost: item.cost,
    shopable: item.shopable === true,
    disabled: item.disabled === true,
    activation: item.activation,
    is_active_item: item.is_active_item === true,
    component_items: item.component_items ?? [],
    shop_image: item.shop_image,
    shop_image_webp: item.shop_image_webp,
    image: item.image,
    image_webp: item.image_webp,
    description: mapStrings(item.description),
    tooltip_sections: sections,
    properties,
  };
}

function trimAbility(ability, slot) {
  const properties = {};
  for (const [name, p] of Object.entries(ability.properties ?? {})) {
    const sf = p.scale_function;
    if (isZeroish(p.value) && !(sf && sf.stat_scale)) continue;
    properties[name] = {
      ...pick(p, PROP_KEYS),
      ...(sf
        ? { scale_function: pick(sf, ['class_name', 'subclass_name', 'specific_stat_scale_type', 'stat_scale', 'scaling_stats']) }
        : {}),
    };
  }
  return {
    id: ability.id,
    class_name: ability.class_name,
    name: ability.name,
    slot,
    ability_type: ability.ability_type,
    image: ability.image,
    image_webp: ability.image_webp,
    description: mapStrings(ability.description),
    upgrades: ability.upgrades ?? [],
    properties,
  };
}

const WEAPON_KEYS = [
  'bullet_damage', 'bullets', 'burst_shot_count', 'cycle_time', 'intra_burst_cycle_time', 'clip_size', 'reload_duration',
  'range', 'damage_falloff_start_range', 'damage_falloff_end_range', 'damage_falloff_start_scale', 'damage_falloff_end_scale',
  'bullet_speed', 'crit_bonus_start', 'can_zoom',
];

const HERO_IMAGE_KEYS = ['icon_hero_card_webp', 'icon_image_small_webp', 'minimap_image_webp', 'icon_hero_card', 'icon_image_small', 'name_image'];

function pickHeroBasics(hero) {
  return {
    id: hero.id,
    class_name: hero.class_name,
    name: hero.name,
    hero_type: hero.hero_type,
    tags: hero.tags ?? [],
    gun_tag: hero.gun_tag ?? null,
    complexity: hero.complexity ?? null,
    images: pick(hero.images ?? {}, HERO_IMAGE_KEYS),
  };
}

function levelRequirements(levelInfo) {
  return Object.fromEntries(
    Object.entries(levelInfo ?? {}).map(([lvl, info]) => [lvl, info?.required_gold ?? null]),
  );
}

// ---------------------------------------------------------------- images (kept locally so the app works offline)

const IMAGE_ROOT = 'https://assets-bucket.deadlock-api.com/assets-api-res/';
const INLINE_IMG = /<img[^>]*?\ssrc="([^"]+)"/g;

function collectImageUrls(catalogItems, kits, heroList) {
  const urls = new Set();
  const add = (u) => typeof u === 'string' && u.startsWith(IMAGE_ROOT) && urls.add(u);
  const scanHtml = (html) => {
    if (typeof html !== 'string') return;
    for (const m of html.matchAll(INLINE_IMG)) add(m[1]);
  };
  const byClass = new Map(catalogItems.map((i) => [i.class_name, i]));
  const wanted = new Set();
  for (const item of catalogItems) {
    if (!item.shopable) continue;
    wanted.add(item);
    for (const c of item.component_items) if (byClass.has(c)) wanted.add(byClass.get(c));
  }
  for (const item of wanted) {
    add(item.shop_image_webp);
    scanHtml(item.description?.desc);
    for (const s of item.tooltip_sections) for (const a of s.section_attributes) scanHtml(a.loc_string);
  }
  for (const hero of heroList) {
    add(hero.images?.icon_hero_card_webp);
    add(hero.images?.icon_image_small_webp);
  }
  for (const kit of kits) {
    for (const ab of kit.abilities) {
      add(ab.image_webp);
      scanHtml(ab.description?.desc);
    }
  }
  return [...urls].sort();
}

async function downloadImages(urls) {
  const manifest = {};
  const failed = [];
  const queue = [...urls];
  let fresh = 0;
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      const rel = 'img/' + url.slice(IMAGE_ROOT.length).replace(/^images\//, '');
      const file = path.join(OUT, rel);
      if (existsSync(file) && statSync(file).size > 0) {
        manifest[url] = rel;
        continue;
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (!buf.length) throw new Error('empty body');
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, buf);
          manifest[url] = rel;
          fresh++;
          break;
        } catch (err) {
          if (attempt === 3) failed.push({ url, error: String(err.message) });
          else await sleep(700 * 2 ** attempt);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1)));
  await writeJson('img/manifest.json', sorted, { pretty: true });
  console.log(`images: ${Object.keys(sorted).length} available (${fresh} downloaded), ${failed.length} failed`);
  for (const f of failed.slice(0, 10)) console.log(`  failed: ${f.url} (${f.error})`);
  return { available: Object.keys(sorted).length, failed: failed.length };
}

// ---------------------------------------------------------------- aggregate analytics

function compactAbilityOrder(rows, heroAbilityIds) {
  const ids = [...heroAbilityIds];
  const symbols = '0123456789abcdefghijklmnopqrstuvwxyz';
  const sorted = [...rows].sort((a, b) => b.matches - a.matches || String(a.abilities).localeCompare(String(b.abilities)));
  const total = sorted.reduce((s, r) => s + r.matches, 0);
  const kept = [];
  let covered = 0;
  for (const row of sorted) {
    if (kept.length >= 1200 || covered / total >= 0.85) break;
    let seq = '';
    for (const id of row.abilities) {
      let idx = ids.indexOf(id);
      if (idx < 0) {
        ids.push(id);
        idx = ids.length - 1;
      }
      seq += symbols[idx] ?? '?';
    }
    kept.push([seq, row.wins, row.losses]);
    covered += row.matches;
  }
  return { abilityIds: ids, totalMatches: total, totalRows: rows.length, keptRows: kept.length, coveredMatches: covered, rows: kept };
}

async function fetchAnalytics(heroes, abilityIdsByHero, window) {
  const common = {
    min_unix_timestamp: window.minUnixTimestamp,
    min_average_badge: cfg.minBadge,
    match_mode: 'ranked,unranked',
    game_mode: 'normal',
  };
  const query = { ...common };
  let n = 0;
  for (const hero of heroes) {
    n++;
    const tag = `[${n}/${heroes.length}] ${hero.name} (${hero.id})`;
    const files = {
      items: `analytics/item-stats-${hero.id}.json`,
      abilities: `analytics/ability-order-${hero.id}.json`,
      perms: `analytics/permutation-stats-${hero.id}.json`,
    };
    if (cfg.resume && Object.values(files).every((f) => existsSync(path.join(OUT, f)))) {
      console.log(`${tag} analytics already present, skipping`);
      continue;
    }
    const fetchedAt = new Date().toISOString();
    const items = await getJson(`${API}/v1/analytics/item-stats?${qs({ ...common, hero_id: hero.id, min_matches: 30 })}`);
    await writeJson(files.items, {
      query: { ...query, hero_id: hero.id, min_matches: 30 },
      fetchedAt,
      rows: items.map((r) => pick(r, ['item_id', 'wins', 'losses', 'matches', 'players', 'avg_buy_time_s', 'avg_sell_time_s'])),
    });

    const abilityRows = await getJson(`${API}/v1/analytics/ability-order-stats?${qs({ ...common, hero_id: hero.id })}`);
    await writeJson(files.abilities, {
      query: { ...query, hero_id: hero.id },
      fetchedAt,
      note: 'Each row is [sequence, wins, losses]. sequence has one character per ability point spent; the character indexes abilityIds. First occurrence of an ability = unlock, later occurrences = upgrade tiers 1..3.',
      ...compactAbilityOrder(abilityRows, abilityIdsByHero.get(hero.id) ?? []),
    });

    const perms = await getJson(`${API}/v1/analytics/item-permutation-stats?${qs({ ...common, hero_id: hero.id, comb_size: 2, min_matches: 50 })}`);
    const topPerms = [...perms]
      .sort((a, b) => b.matches - a.matches || a.item_ids[0] - b.item_ids[0])
      .slice(0, 2000)
      .map((r) => [r.item_ids[0], r.item_ids[1], r.wins, r.losses]);
    await writeJson(files.perms, {
      query: { ...query, hero_id: hero.id, comb_size: 2, min_matches: 50 },
      fetchedAt,
      note: 'Each row is [itemA, itemB, wins, losses] for players who bought both items. Top 2000 pairs by matches.',
      totalRows: perms.length,
      rows: topPerms,
    });
    console.log(`${tag} items=${items.length} abilityOrders=${abilityRows.length} pairs=${perms.length}`);
  }
}

// ---------------------------------------------------------------- player data

function trimHistoryRow(r) {
  return pick(r, [
    'match_id', 'hero_id', 'start_time', 'match_duration_s', 'match_result', 'player_team', 'game_mode', 'match_mode',
    'player_kills', 'player_deaths', 'player_assists', 'net_worth', 'last_hits', 'hero_level', 'abandoned_time_s', 'team_abandoned',
  ]);
}

async function fetchUserHistory() {
  const rows = await getJson(`${API}/v1/players/${USER_ACCOUNT_ID}/match-history`);
  const standard = rows.filter((r) => r.game_mode === NORMAL_GAME_MODE);
  await writeJson('player/match-history.json', {
    account_id: USER_ACCOUNT_ID,
    fetchedAt: new Date().toISOString(),
    note: 'Standard (game_mode 1) matches only. match_result === player_team means a win.',
    totalRows: rows.length,
    rows: standard.map(trimHistoryRow),
  });
  console.log(`player ${USER_ACCOUNT_ID}: ${standard.length} standard matches of ${rows.length}`);
  return { totalRows: rows.length, standardRows: standard.length };
}

async function fetchValidationData(catalogIds) {
  const history = await getJson(`${API}/v1/players/${VALIDATION_ACCOUNT_ID}/match-history`);
  const candidates = history
    .filter(
      (r) =>
        r.hero_id === VALIDATION_HERO_ID &&
        r.game_mode === NORMAL_GAME_MODE &&
        REAL_MATCH_MODES.has(r.match_mode) &&
        !(r.abandoned_time_s > 0),
    )
    .sort((a, b) => b.start_time - a.start_time || b.match_id - a.match_id);
  console.log(`validation player: ${history.length} history rows, ${candidates.length} real matchmaking hero-${VALIDATION_HERO_ID} matches`);

  const matches = [];
  const skipped = [];
  for (const row of candidates) {
    if (matches.length >= cfg.matchCount) break;
    let meta;
    try {
      meta = await getJson(`${API}/v1/matches/${row.match_id}/metadata?disable_steam=true`, { allow404: true, retries: 3 });
    } catch (err) {
      skipped.push({ match_id: row.match_id, reason: String(err.message).slice(0, 120) });
      continue;
    }
    const info = meta?.match_info;
    const player = info?.players?.find((p) => p.account_id === VALIDATION_ACCOUNT_ID);
    if (!info || !player) {
      skipped.push({ match_id: row.match_id, reason: 'metadata unavailable' });
      continue;
    }
    if (player.hero_id !== VALIDATION_HERO_ID || info.game_mode !== NORMAL_GAME_MODE || !REAL_MATCH_MODES.has(info.match_mode) || info.bot_difficulty > 0) {
      skipped.push({ match_id: row.match_id, reason: 'not a real matchmaking match for this hero' });
      continue;
    }
    const purchases = (player.items ?? [])
      .filter((it) => catalogIds.has(it.item_id))
      .map((it) => ({ item_id: it.item_id, bought_s: it.game_time_s, sold_s: it.sold_time_s > 0 ? it.sold_time_s : null }))
      .sort((a, b) => a.bought_s - b.bought_s || a.item_id - b.item_id);
    matches.push({
      match_id: row.match_id,
      start_time: info.start_time,
      duration_s: info.duration_s,
      match_mode: info.match_mode,
      won: info.winning_team === player.team,
      net_worth: player.net_worth,
      purchases,
    });
    process.stdout.write(`  match ${matches.length}/${cfg.matchCount}: ${row.match_id} (${purchases.length} purchases)\n`);
  }

  const fetchedAt = new Date().toISOString();
  await writeJson('zergggy/match-history-infernus.json', {
    account_id: VALIDATION_ACCOUNT_ID,
    hero_id: VALIDATION_HERO_ID,
    fetchedAt,
    note: 'Validation data only. Real matchmaking (game_mode 1, match_mode 1 or 4), no abandons, newest first.',
    historyRows: history.length,
    candidateMatches: candidates.length,
    selected: candidates.filter((c) => matches.some((m) => m.match_id === c.match_id)).map(trimHistoryRow),
    skipped,
  });
  await writeJson('zergggy/purchases-infernus.json', {
    account_id: VALIDATION_ACCOUNT_ID,
    hero_id: VALIDATION_HERO_ID,
    fetchedAt,
    note: 'Validation data only. Catalog-item purchases per match: bought_s / sold_s are game seconds.',
    matches,
  });
  console.log(`validation data: ${matches.length} matches saved, ${skipped.length} skipped`);
  return { matches: matches.length, skipped: skipped.length, fetchedAt };
}

// ---------------------------------------------------------------- main

async function main() {
  const started = Date.now();
  await mkdir(OUT, { recursive: true });
  const prevMeta = (await readJsonIfExists('meta.json')) ?? {};

  if (cfg.zergggyOnly) {
    const catalog = await readJsonIfExists('catalog.json');
    if (!catalog) throw new Error('catalog.json is missing; run a full fetch first');
    const validation = await fetchValidationData(new Set(catalog.items.map((i) => i.id)));
    await writeJson('meta.json', { ...prevMeta, validationData: { included: true, account_id: VALIDATION_ACCOUNT_ID, hero_id: VALIDATION_HERO_ID, ...validation } }, { pretty: true });
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s, ${requestCount} requests`);
    return;
  }

  console.log(`Deadlock API snapshot -> ${path.relative(process.cwd(), OUT) || OUT}`);

  // Analytics window: since the newest patch, but never less than 7 or more than 30 days.
  const patches = await getJson(`${API}/v1/patches`);
  const patchTimes = patches.map((p) => Date.parse(p.pub_date) / 1000).filter(Number.isFinite);
  const now = Math.floor(Date.now() / 1000);
  const latestPatch = patchTimes.length ? Math.max(...patchTimes) : now - 30 * DAY;
  let windowStart = Math.max(latestPatch, now - 30 * DAY);
  if (now - windowStart < 7 * DAY) windowStart = now - 7 * DAY;
  const window = {
    minUnixTimestamp: Math.floor(windowStart),
    latestPatchUnix: Math.floor(latestPatch),
    days: Number(((now - windowStart) / DAY).toFixed(1)),
  };
  console.log(`window: since ${new Date(window.minUnixTimestamp * 1000).toISOString()} (${window.days} days), rank floor badge >= ${cfg.minBadge}`);

  // Heroes
  const allActive = await getJson(`${API}/v1/assets/heroes?only_active=true`);
  const heroes = allActive
    .filter((h) => !h.disabled && h.player_selectable !== false)
    .sort((a, b) => a.id - b.id);
  const selected = cfg.heroFilter ? heroes.filter((h) => cfg.heroFilter.includes(h.id)) : heroes;
  console.log(`${heroes.length} active heroes (${selected.length} selected for this run)`);

  // Item catalog
  const upgrades = await getJson(`${API}/v1/assets/items/by-type/upgrade`);
  const catalogItems = upgrades.map(trimItem).sort((a, b) => a.id - b.id);
  const catalogMeta = {
    source: `${API}/v1/assets/items/by-type/upgrade`,
    fetchedAt: new Date().toISOString(),
    items: catalogItems,
  };
  await writeJson('catalog.json', catalogMeta);
  const shopable = catalogItems.filter((i) => i.shopable);
  console.log(`catalog: ${catalogItems.length} items, ${shopable.length} shopable`);

  // Weapons (for kit profile) and per-hero ability data
  const weapons = await getJson(`${API}/v1/assets/items/by-type/weapon`);
  const weaponByClass = new Map(weapons.map((w) => [w.class_name, w]));
  const abilityIdsByHero = new Map();
  const heroSummaries = [];
  const kits = [];
  let k = 0;
  for (const hero of selected) {
    k++;
    const heroItems = await getJson(`${API}/v1/assets/items/by-hero-id/${hero.id}`);
    const byClass = new Map(heroItems.map((i) => [i.class_name, i]));
    const slots = ['signature1', 'signature2', 'signature3', 'signature4'];
    const abilities = [];
    for (const slot of slots) {
      const cls = hero.items?.[slot];
      const ab = cls ? byClass.get(cls) : undefined;
      if (ab) abilities.push(trimAbility(ab, slot));
      else console.log(`  warn: ${hero.name} has no ability for ${slot} (${cls})`);
    }
    abilityIdsByHero.set(hero.id, abilities.map((a) => a.id));
    const weapon = weaponByClass.get(hero.items?.weapon_primary);
    const kit = {
      ...pickHeroBasics(hero),
      description: mapStrings(hero.description),
      starting_stats: Object.fromEntries(Object.entries(hero.starting_stats ?? {}).map(([key, v]) => [key, v?.value])),
      cost_bonuses: hero.cost_bonuses,
      standard_level_up_upgrades: hero.standard_level_up_upgrades,
      item_slot_info: hero.item_slot_info,
      level_requirements: levelRequirements(hero.level_info),
      weapon: weapon ? { class_name: weapon.class_name, name: weapon.name, weapon_info: pick(weapon.weapon_info ?? {}, WEAPON_KEYS) } : null,
      abilities,
    };
    await writeJson(`heroes/${hero.id}.json`, kit);
    kits.push(kit);
    heroSummaries.push(pickHeroBasics(hero));
    console.log(`[${k}/${selected.length}] kit ${hero.name}: ${abilities.map((a) => a.name).join(', ')}`);
  }
  if (!cfg.heroFilter) await writeJson('heroes.json', { fetchedAt: new Date().toISOString(), heroes: heroSummaries });

  // Aggregate analytics
  const heroStats = await getJson(`${API}/v1/analytics/hero-stats?${qs({ min_unix_timestamp: window.minUnixTimestamp, min_average_badge: cfg.minBadge, match_mode: 'ranked,unranked', game_mode: 'normal' })}`);
  await writeJson('analytics/hero-stats.json', {
    query: { min_unix_timestamp: window.minUnixTimestamp, min_average_badge: cfg.minBadge, match_mode: 'ranked,unranked', game_mode: 'normal' },
    fetchedAt: new Date().toISOString(),
    rows: heroStats.map((r) => pick(r, ['hero_id', 'wins', 'losses', 'matches', 'total_net_worth', 'total_kills', 'total_deaths', 'total_assists'])),
  });
  await fetchAnalytics(selected, abilityIdsByHero, window);

  // Images (shop icons, hero cards, ability icons) are stored locally so the app needs no network.
  const images = await downloadImages(collectImageUrls(catalogItems, kits, heroSummaries));

  // Personalization data
  const user = await fetchUserHistory();

  // Validation data (held out; generator never reads it)
  let validation = prevMeta.validationData ?? { included: false };
  if (!cfg.skipZergggy) {
    const v = await fetchValidationData(new Set(catalogItems.map((i) => i.id)));
    validation = { included: true, account_id: VALIDATION_ACCOUNT_ID, hero_id: VALIDATION_HERO_ID, ...v };
  } else if (!prevMeta.validationData) {
    validation = { included: false };
  }

  const ranks = await getJson(`${API}/v1/assets/ranks`).catch(() => null);
  const rankName = ranks?.find((r) => r.tier === Math.floor(cfg.minBadge / 10))?.name ?? null;
  await writeJson(
    'meta.json',
    {
      schema: 1,
      fetchedAt: new Date().toISOString(),
      api: API,
      analytics: {
        window,
        minAverageBadge: cfg.minBadge,
        rankFloor: rankName ? `${rankName} and above` : null,
        matchMode: 'ranked,unranked',
        gameMode: 'normal',
        corruptedItems: 'exclude (API default)',
      },
      counts: { catalogItems: catalogItems.length, shopableItems: shopable.length, heroes: heroes.length },
      images,
      heroIds: heroes.map((h) => h.id),
      player: { account_id: USER_ACCOUNT_ID, ...user },
      validationData: validation,
    },
    { pretty: true },
  );
  if (shopable.length < 200) {
    console.log(`note: the catalog has ${shopable.length} shopable items (the brief expected >= 200); ${catalogItems.length - shopable.length} more are disabled in the API.`);
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s, ${requestCount} requests`);
}

main().catch((err) => {
  console.error(`fetch-data failed: ${err.message}`);
  process.exit(1);
});
