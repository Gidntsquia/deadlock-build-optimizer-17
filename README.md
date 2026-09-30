# Deadlock Build Optimizer

A mobile-first web app that builds item lists for any Deadlock hero from real aggregate data: how often each item is bought, how often the buyer wins, what it costs, what it does, and how the hero's kit scales. Each build is an ordered buy list (early / mid / late, with a running soul total) plus an ability level-up order. Tap any item for a detail card.

Infernus is the default hero and the only one tuned and validated. The other 37 active heroes generate and render from the same code, but nothing was tuned for them.

The app is a static site (React 18, Vite, TypeScript). It has no backend, database, login or paid service. It reads JSON snapshots that `npm run fetch-data` writes from the public [Deadlock API](https://api.deadlock-api.com), so after one fetch it works offline.

## Run it

Needs Node 20.19 or newer.

```sh
npm install
npm run fetch-data   # downloads the snapshots into public/data (about 2 minutes, ~13 MB)
npm run dev          # http://localhost:5173, also reachable from a phone on the same network
```

A snapshot taken on 2026-09-30 is already in `public/data`, so `npm install && npm run dev` works without `fetch-data`. Run `fetch-data` again to refresh; the numbers in this README describe that snapshot and will move when you do.

| Command | What it does |
| --- | --- |
| `npm run fetch-data` | Downloads and snapshots all data (see "Data pipeline"). Flags: `--skip-zergggy`, `--zergggy-only`, `--heroes=1,2`, `--resume`, `--min-badge=70`, `--matches=30`. |
| `npm run dev` | Vite dev server. |
| `npm run build` | `tsc --noEmit` then `vite build` into `dist/`. No network needed. |
| `npm run preview` | Serves `dist/`. |
| `npm run generate` | Prints the generated builds for Infernus (or `-- 2 5` for other hero ids, `-- --all` for every hero, `-- --json`), with the determinism hashes. |
| `npm run validate` | Prints the Infernus validation report (core set and agreement per build). |
| `npm run check` | Verifies the data and code-level acceptance criteria (see "Verification"). `-- --live` also compares the catalog with the live API; `-- --write-docs` regenerates the parameter tables below. |
| `npm run e2e` | Builds with the network off, serves `dist/`, and drives headless Chromium at 390×844 and 1280×800 through the UI acceptance criteria. Needs a Chromium in the Playwright cache (`npx playwright-core install chromium`). |

### Live site (GitHub Pages)

The app is published at https://gidntsquia.github.io/deadlock-build-optimizer-17/. `.github/workflows/deploy.yml` runs `npm ci` and `npm run build` on every push to `main` (or by hand from the Actions tab) and publishes `dist/`. The build needs no network, because the snapshot is committed in `public/data`, and the relative `base` in `vite.config.ts` makes the app work under the `/deadlock-build-optimizer-17/` sub-path.

To refresh the live data: run `npm run fetch-data`, commit `public/data`, and push. Pages is switched on in the repository settings with Source set to "GitHub Actions".

## What you see

- **Hero picker** (top bar): all active heroes, searchable. The hero is kept in the address (`#hero=<id>`), so a link opens that hero.
- **Build tabs**: Gun Damage, Spirit & Burn, Hybrid.
- **Summary**: build name, total souls, and (Infernus) the agreement % with the reference player.
- **Buy list**: grouped early / mid / late. Each row has the shop image, name, tier and slot colour, its price, the running soul total, and a core / not-core badge (Infernus). Components that the build buys early and later upgrades are listed as their own purchases, because you really spend those souls.
- **Ability order**: 16 points in order, each marked "Unlock" or "Upgrade 1–3", with the four real ability names. Below it, one card per ability with its upgrade text.
- **Your pace**: insight from your own match history (see "Personalization").
- **Validation**: how well the generator did against the reference player (see "Validation").
- **Item card** (tap any item anywhere, including the chips for "Built from" and "Upgrades into"): shop image, cost, tier, slot type, stat lines, and passive / active text, all from the assets data. On a phone it is a bottom sheet; on a desktop it is centered.

Layout: phone first (checked at 390×844, 360 and 320 wide), tap targets at least 44 px, and on wide screens a centered 560 px column.

## Data pipeline

`npm run fetch-data` (`scripts/fetch-data.mjs`) writes everything under `public/data/`. The app and the scripts read only those files.

| File | Content |
| --- | --- |
| `meta.json` | Fetch time, analytics window, rank floor, counts. |
| `catalog.json` | The item catalog from `/v1/assets/items/by-type/upgrade` (250 items, 173 shopable). |
| `heroes.json`, `heroes/<id>.json` | All active heroes from `/v1/assets/heroes?only_active=true`, and the kit of each (abilities, weapon, level growth, soul-investment bonuses). |
| `analytics/item-stats-<id>.json` | Per-item matches, wins, average buy time for that hero (`/v1/analytics/item-stats`). |
| `analytics/ability-order-<id>.json` | Ability-point sequences with wins and losses (`/v1/analytics/ability-order-stats`). |
| `analytics/permutation-stats-<id>.json` | Win rate of item pairs (`/v1/analytics/item-permutation-stats`, pairs, top 2,000 by matches). |
| `analytics/hero-stats.json` | Matches, wins and net worth per hero (`/v1/analytics/hero-stats`). |
| `player/match-history.json` | Your match history (account 267836488), standard mode only. |
| `zergggy/match-history-infernus.json`, `zergggy/purchases-infernus.json` | Validation data only: the reference player's Infernus match list, and the item purchases of his 30 most recent real matchmaking Infernus matches (see "Validation"). |
| `img/` and `img/manifest.json` | Local copies of every image the app shows (shop images, ability icons, hero portraits, inline tooltip icons). The manifest maps the remote URL to the local file. |

Window and filters for all aggregate analytics: matches since the latest patch (kept between 7 and 30 days; 13.9 days at the last fetch), average badge 70 or higher ("Emissary and above"), ranked and unranked matchmaking, normal game mode. Requests are paced at about two per second and retried on HTTP 429 and 5xx, well inside the API's shared limit.

## How builds are generated

`src/generator/` is a pure function: `generateBuilds(inputs, params)`. Same snapshot and same parameters give the same builds, byte for byte. There is no randomness and no clock, and every tie is broken by item id (see "Determinism").

**Inputs.** Match data: only the aggregate analytics snapshots listed above (`item-stats`, `ability-order`, `permutation-stats`, plus `hero-stats` for the hero's match count, win rate and average final net worth). Everything else is assets data: the item catalog and the hero's kit. The generator does not read the reference player's data or yours.

**Scoring.** Each candidate purchase gets a score given the items already chosen, the game phase and the build style:

```
score(item | owned items, phase, style) =
    w.win    · clamp(winLift / winLiftScale, ±2.5) · sqrt(min(1, pickRate / reliablePickRate))
  + w.pick   · min(pickRate / pickRateCap, 1)
  + w.power  · compress(ln-power gained per 1,000 net souls / powerRefPerK)
  + w.kit    · kitFit(item, hero kit)
  + w.pair   · clamp(mean pair lift with the owned items / pairLiftScale, ±1.5)
  + w.timing · -min(1.5, seconds outside the phase's buy window / 300)
  + style.slotBias[item slot]

w = phaseWeights[phase]      compress(x) = x / (1 + |x| / 4)
```

| Term | What it measures | Where it comes from |
| --- | --- | --- |
| win rate | Win rate of the item's buyers minus the win rate of players who bought other items at about the same time (Gaussian kernel, `baselineBandwidthS`), pulled toward that baseline by `shrinkMatches`. Raw win rates are biased: expensive items are bought late, in games that last, by the team that is ahead. | item-stats |
| usage | Share of the hero's matches where the item was bought. | item-stats, hero-stats |
| stat value per soul | How much the item raises a weighted sum of ln(gun damage/s), ln(spirit damage/s), ln(effective health) and a small utility term, per 1,000 souls of net cost. The weights come from the style. Stats that scale per level use the hero's growth values. | assets (catalog, kit) |
| soul thresholds | The extra power from pushing a slot's total spend past a soul-investment bonus step (the hero's `cost_bonuses`). | assets (kit) |
| passives & actives | Damage procs become damage per second, barriers and heals become effective health, crowd control and mobility become utility. Effects count at an uptime. With a stated cooldown: effect duration ÷ `fightS` (or `passiveUptime` / `activeUptime` if no duration is stated), times 45 s ÷ cooldown, kept between 0.2 and 1. With no cooldown: `passiveUptime` or `activeUptime`. A few always-on stats count in full. | assets (catalog) |
| kit fit | Extra credit when an item feeds something the hero's abilities use. Charge items get 0.8 × the share of the hero's abilities that have charges; range items 0.6 × the share that scale with range; crowd-control items 0.5 (0.15 when the hero already has crowd control); damage procs 0.3 when the hero's kit deals damage over time; fire rate or magazine 0.4 when an ability is coupled to the gun (Infernus's Afterburn). | assets (kit) |
| pair synergy | Win rate of players who own both items minus what the two items predict separately, shrunk by sample size; averaged over the owned items the new item will sit next to (not the ones it replaces). | permutation-stats |
| timing | Penalty when the item's typical buy time falls outside the phase's window. | item-stats |
| build style | A fixed bonus per slot type, so the gun build leans on weapon items and the spirit build on spirit items. | parameters |

**Power model.** `src/generator/power.ts` reads the hero's weapon (damage, rate of fire, magazine, reload), per-level growth and ability damage, then computes sustained gun damage per second, sustained spirit damage per second and effective health for a set of owned items, at the build's net worth plus `unspentSouls`. For Infernus this includes Afterburn: bullets that hit build up a burn, so fire rate and accuracy raise burn uptime, and spirit power and duration raise its damage. Gains are measured at one fixed net worth, so level growth cancels.

**Selection.** The build is filled greedily in three phases of final items (early 3, mid 5, late 4 = 12 final items). The plan limits item tier per phase, items of one slot type per phase and in the inventory, and active items held at once. The total is held under a budget: `budgetShare` (90%) of the hero's average final net worth. If no candidate passes the normal limits, a four-step relaxation ladder retries: first the normal limits, then without the tier limits, then also without the per-phase slot cap, then also with the lower match-count and pick-rate floors (`fallback`) and up to 10% over budget. That is how every hero reaches 12 items.

**Upgrades and net cost.** An item built from components can be bought as an upgrade: it consumes the owned components and is credited their price, so it costs less. Running totals use that net cost. "Stepping stones" (popular cheap components the build buys early and upgrades later) are added to the buy list, so the buy order matches how the game's shop is used. The buy list is ordered by phase, then by the item's average buy time in the data.

**Ability order.** `src/generator/abilities.ts` walks the recorded ability-point sequences as a tree, one point at a time. At each point it takes the branch with the best shrunk win rate among branches that keep at least `ability.minBranchShare` of the matches at that point. The first point put into an ability is labelled "Unlock"; the later ones are upgrade tiers 1 to 3. The result is always 16 points. Points past what the data supports (few matches last that long) are filled in and flagged "no data this far" in the UI, and each build shows how many matches back each stretch of the order.

### Parameters and weights

Every tunable number the generator uses is in `src/generator/params.ts` with a doc comment. The tables below are generated from that file by `npm run check -- --write-docs`, and `npm run check` fails if they drift.

A few constants are fixed in the code, not in `params.ts`, and appear in the formula above: the `compress` divisor 4, the win-lift score clamp ±2.5, the pair score clamp ±1.5, the timing scale (300 s per point, capped at 1.5), the kit-fit values in the table above, and a 200-soul floor on an item's net cost in the per-soul power term (so a nearly free upgrade does not score infinity).

<!-- params:begin (generated by `npm run check -- --write-docs`, do not edit by hand) -->

**Evidence**

| Parameter | Default | Meaning |
| --- | --- | --- |
| `minMatches` | 150 | items below this many matches for the hero are not candidates |
| `minPickRate` | 0.05 | items bought in fewer than this share of the hero's matches are not candidates |
| `shrinkMatches` | 500 | prior strength (in matches) that pulls each item's win rate toward its buy-time baseline |
| `baselineBandwidthS` | 240 | Gaussian kernel width (seconds) for the buy-time win-rate baseline |
| `baselinePrior` | 10 | weight of the hero's overall win rate inside the baseline (in sqrt-match units) |
| `winLiftScale` | 0.02 | a shrunk lift of this size (win-rate fraction) scores 1.0 |
| `pickRateCap` | 0.6 | pick rates at or above this score 1.0 |
| `reliablePickRate` | 0.1 | win-lift evidence is discounted below this pick rate (weight = sqrt(pick / this)) |
| `pairLiftScale` | 0.02 | pair lift of this size scores 1.0 |
| `pairShrinkMatches` | 800 | prior strength (matches) for pair lifts |

**Power model**

| Parameter | Default | Meaning |
| --- | --- | --- |
| `accuracy` | 0.7 | share of gun shots that land |
| `headshotRate` | 0.2 | share of landed bullets that are headshots (for flat headshot bonuses) |
| `passiveUptime` | 0.4 | assumed uptime of a passive effect with no stated cooldown/duration |
| `activeUptime` | 0.25 | assumed uptime of an active effect with no stated cooldown/duration |
| `maxCdr` | 0.6 | longest cooldown reduction the model credits |
| `minCycleS` | 3 | shortest time between two casts the model credits (seconds) |
| `fightS` | 10 | seconds of a typical fight, used to turn barriers/heals into effective health |
| `unspentSouls` | 600 | souls the hero has earned but not spent, added to spend when estimating level |
| `bulletShare` | 0.6 | weight of each damage type when blending resistances into effective health |
| `powerRefPerK` | 0.05 | a power gain of this many ln-units per 1000 souls scores 1.0 |
| `utilityUnit` | 0.05 | ln-power value of one utility unit (crowd control, mobility) |

**Selection**

| Parameter | Default | Meaning |
| --- | --- | --- |
| `phaseWindowS.early` | [0, 600] | each phase's buy-time window in seconds; items bought outside it lose "timing" score |
| `phaseWindowS.mid` | [420, 1260] | each phase's buy-time window in seconds; items bought outside it lose "timing" score |
| `phaseWindowS.late` | [900, 4000] | each phase's buy-time window in seconds; items bought outside it lose "timing" score |
| `maxPerSlot` | 6 | the inventory holds at most this many items of one slot type (weapon, vitality, spirit) at any time |
| `maxActives` | 3 | the inventory holds at most this many items with an active ability at any time |
| `budgetShare` | 0.9 | budget = this share of the hero's average end-of-match net worth |
| `stones.minPickRate` | 0.15 | a component must be bought in at least this share of the hero's matches |
| `stones.maxTier` | 2 | highest tier of component that may be used as a stepping stone |
| `stones.max` | 5 | most stepping stones per build |
| `fallback.minMatches` | 40 | relaxed match-count floor |
| `fallback.minPickRate` | 0.005 | relaxed pick-rate floor |
| `fallback.budgetSlack` | 0.1 | share of the budget a build may exceed while relaxed |

**Ability order**

| Parameter | Default | Meaning |
| --- | --- | --- |
| `ability.minBranchShare` | 0.2 | a branch needs at least this share of the prefix's matches to be considered |
| `ability.shrinkMatches` | 60 | prior strength (matches) for branch win rates |
| `ability.styleTilt` | 0.01 | win-rate points (fraction) added per unit of style affinity, to break near-ties |

**Score term weights per game phase** (`phaseWeights`)

| Phase | `win` | `pick` | `power` | `kit` | `pair` | `timing` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| early | 0.6 | 1 | 1.2 | 0.4 | 0.3 | 0.5 |
| mid | 1 | 0.8 | 1 | 0.5 | 0.6 | 0.5 |
| late | 1.2 | 0.6 | 0.9 | 0.6 | 0.8 | 0.4 |

- `win`: shrunk win-rate lift against items bought at the same time (evidence)
- `pick`: how often players of this hero buy the item (evidence)
- `power`: stat value per soul from the power model (innate stats, thresholds, passives/actives)
- `kit`: kit-specific fit (charges, range/duration, crowd control for heroes whose abilities use them)
- `pair`: pair synergy with items already chosen (permutation stats)
- `timing`: how well the item's typical buy time matches the phase

**Phase plan** (`plan`)

| `phase` | `count` | `minTier` | `maxTier` | `maxPerSlot` | `maxUpgrades` |
| --- | --- | --- | --- | --- | --- |
| early | 3 | 1 | 2 | 2 | 2 |
| mid | 5 | 2 | 3 | 3 | 3 |
| late | 4 | 3 | 5 | 3 | 3 |

- `count`: final items picked in this phase
- `minTier`: lowest tier of a newly bought (not upgraded) item in this phase
- `maxTier`: highest tier of any pick in this phase
- `maxPerSlot`: at most this many new picks from the same slot type inside the phase
- `maxUpgrades`: upgrades of items already owned (they consume the component) allowed in this phase, on top of `count`

**Build styles** (`styles`)

| Style | `aGun` | `aSpirit` | `aSurv` | `aUtil` | `slotBias.weapon` | `slotBias.vitality` | `slotBias.spirit` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gun | 1 | 0.25 | 0.35 | 0.3 | 0.6 | 0 | -0.25 |
| spirit | 0.25 | 1 | 0.35 | 0.3 | -0.25 | 0 | 0.6 |
| hybrid | 0.6 | 0.6 | 0.4 | 0.3 | 0 | 0 | 0 |

- `aGun`: weight on gun damage per second in the power model
- `aSpirit`: weight on spirit damage per second
- `aSurv`: weight on effective health
- `aUtil`: weight on utility (crowd control, mobility)
- `slotBias`: score added to every candidate of a slot type, so a gun build leans on weapon items and a spirit build on spirit items

<!-- params:end -->

### Determinism

`generateBuilds` depends only on the snapshot and the parameters. Two runs in one process, and two separate Node processes, give identical JSON (`npm run check` does both; `npm run generate` prints `deterministic=true` and two hashes). For the 2026-09-30 snapshot: generator version 1.0.0, parameters hash `150cabebcc999f`, Infernus build-set hash `0b655e5850b717`. A new fetch changes the data, so the build-set hash changes with it; the parameters hash changes only when you edit the parameters.

## Validation against the reference player

Validation is a separate step that runs after generation. It compares the generated builds with the actual Infernus item choices of the top player Zergggy (account 35187362). His data is a **held-out** test set: the generator never sees it, and nothing was tuned to raise the agreement number.

**Sample.** His 30 most recent real matchmaking Infernus matches (unranked or ranked, normal mode, no abandons; private lobbies and bot modes are excluded). Per match, the items he bought and when. At fetch time: 20 of the 30 were wins.

**Core set, and what counts as an experiment.** An item is **core** when it shows up in **at least 30% of his sampled matches**, where each won match counts 1.5 times ("shows up" = bought at any time in the match). Items below 30% are **experiments**: his one-off builds are excluded from the core set. The 2026-09-30 sample gives 27 core items and 33 experiments.

**Agreement.** For each generated build:

```
agreement = 0.7 · overlap + 0.3 · order concordance

overlap            = F1 of precision (share of the build's items that are core)
                     and recall (share of the core items the build contains)
order concordance  = among items in both the build and the core set, the share of item pairs
                     that the build buys in the same order as his median first-buy times
                     (ties count half; with fewer than two shared items, overlap alone is used)
```

Every recommended item carries a core / not-core badge (an item he never bought in the sample is "not core · 0/30"), each build shows its agreement, and the validation panel lists the core items, the excluded experiments and the per-build numbers. It is shown as "how well the generator did", not as a source of the build.

**Result, first and only run** (2026-09-30 snapshot, generator 1.0.0, parameters frozen before the run and unchanged since):

| Build | Agreement | Overlap (precision / recall) | Order |
| --- | ---: | --- | ---: |
| Gun Damage | 72.2% | 68% (80% / 59%) | 82% |
| Spirit & Burn | 66.0% | 61% (74% / 52%) | 78% |
| Hybrid | 73.2% | 70% (84% / 59%) | 82% |

I ran validation once and did not tune anything afterwards. The builds contain about half of his core items (recall 52% to 59%) and most of what they contain is core (precision 74% to 84%). The misses are real: Headshot Booster, Extra Regen and Healbane are core for him and appear in none of the three builds. I did not change the generator to pick them up.

**Isolation, and how it is checked.** In the app and generator code, only `src/validation/index.ts` reads the reference snapshot. The fetch script writes it, and the two test scripts (`check`, `e2e`) read it to verify the results. `npm run check` follows the import graph of `src/generator/index.ts` and `src/data/snapshots.ts`, fails if it reaches the validation or personalization code or contains `zergggy`, `35187362` or `purchases-infernus`, and then generates builds for every hero with a file reader that throws if the generator asks for any path containing `zergggy`. You can also run `grep -rniE "zergggy|35187362|purchases-infernus" src/generator src/data`; it prints nothing.

## Personalization

The "Your pace" card uses your own matches (account 267836488, standard mode only, from `player/match-history.json`): the median match length, souls per minute, median final net worth and win rate on this hero (or across all heroes when there are fewer than 8 games on the hero). The build is annotated with it: each purchase gets an estimated time you reach it (running total ÷ your souls per minute), the point where your typical game has already ended is marked, and the card says how many minutes before or after your typical game's end the build is complete, and how many souls you would have spare against your usual final net worth. For Infernus this snapshot has 378 usable games, a 33 minute median and about 1,240 souls per minute.

It only annotates. It does not change which items are picked, because the generator's only match-data inputs are the aggregate snapshots.

## Verification

`npm run check` and `npm run e2e` test behavior and data shape, never specific item names, because live data changes daily. Results on the 2026-09-30 snapshot:

| Acceptance criterion | How it is checked | Result |
| --- | --- | --- |
| `fetch-data` writes the snapshots: item catalog with at least 200 shopable items, per-hero analytics for every active hero, at least 20 Zergggy matches with purchase data | `check` reads the snapshots; `check --live` compares them with the live API | **Gap on the first item**: the API lists 250 items and 173 are shopable (see judgment call 1). Analytics for all 38 heroes; 30 validation matches (552 purchase records). |
| With snapshots present and the network off, `npm run build` succeeds and the served app renders with no console errors | `e2e` re-runs itself in an empty network namespace (`unshare -rn`), confirms the network is down, builds, serves `dist/`, loads the app, and fails on any console error or warning, page error, failed request, HTTP error or non-local request | Pass |
| Opens on Infernus with at least 2 named builds; each has 12+ items grouped early / mid / late with cost and running total, and each item shows its correct shop image | `e2e` | Pass: 3 builds with 19 to 20 purchases (12 final items) each; every image checked against the catalog's shop image |
| Any 3 other heroes generate and render without errors | `e2e` (picks 3 through the picker, then all 38 heroes) | Pass: 38 heroes, 114 builds, 1,903 purchases |
| Each build shows an ability sequence with the 4 real Infernus names, unlock order and upgrade tiers | `e2e` | Pass: 16 points per build; each ability has a first point and upgrades 1 to 3 |
| Tapping any item opens a card with image, cost, tier, slot type and stat / ability text matching the assets data | `e2e` opens every recommended item of every hero (129 distinct items) and the chip links, and compares each card with `catalog.json` | Pass |
| Every recommended item has a core / not-core badge, each build has an agreement %, and the README states the 30% rule | `e2e` recomputes the core set and the agreement from the raw snapshot and compares with the page; `check` checks this README | Pass |
| The generator imports only the aggregate snapshots; only the validation module reads the reference snapshot | `check` (import graph, text search, guarded reader; see "Isolation") | Pass |
| At 390×844 there is no horizontal scrolling on any screen, and all controls stay tappable | `e2e` measures every screen state (builds, item cards, picker, expanded lists): page width, every element's box, clipped text, and each control's size and whether another element covers it | Pass: no overflow; every control at least 40×40 px |
| This README documents the scoring inputs and weights, and rerunning the generator on the same snapshot gives identical builds | `check` compares the parameter tables with the code and runs the generator twice in-process and in two separate processes | Pass |

## Judgment calls

I built this without being able to ask, so these are the decisions I made. Each is easy to change.

1. **Only 173 shopable items, not 200 or more.** The catalog has 250 upgrade items, but the API marks only 173 as `shopable` (the other 77 are disabled). I did not pad the count. The catalog snapshot keeps all 250 items; the generator only recommends shopable, enabled ones. `npm run check` reports this as a gap instead of failing.
2. **API host moved.** The old `assets.deadlock-api.com/v2` no longer answers; assets now live at `https://api.deadlock-api.com/v1/assets/...`. The fetch script uses the new path.
3. **Data window and rank floor.** Aggregates cover matches since the latest patch (7 to 30 days back), average badge 70 or higher, ranked and unranked normal games. A fresh patch changes the meta, and a rank floor keeps the signal close to how a top player plays while leaving about 31,000 Infernus matches. Both are options on the fetch script.
4. **Corrupted items** are excluded from the analytics, which is the API default.
5. **Builds hold 12 final items, and the buy list also shows components.** The brief asks for a buy list of 12 or more items. A build is 12 final items (early 3, mid 5, late 4); purchases of components that are later upgraded are listed too, since they cost souls and come in the order you buy them (19 to 20 rows for Infernus).
6. **Soul-investment bonuses are read as running totals.** The hero's `cost_bonuses` rise at each threshold (Infernus weapon: 9, 12, 15, 18, 46, …), so the bonus at a spend is the highest step reached, not a sum of steps.
7. **Tooltip sections without a type are treated as passive**, and effects without a stated duration or cooldown use a fixed uptime (`passiveUptime` 0.4, `activeUptime` 0.25). These are guesses, documented in the parameters.
8. **A slot-type bias tilts the build styles, and the effect is modest.** Each style has power-model weights (gun damage against spirit damage) plus one score bonus per slot type, added so the style names show up in the item mix. On this snapshot the Gun Damage and Spirit & Burn builds still share 8 of 12 final items (9 of 12 with the bias set to zero); the bias moves about one weapon item between them (5 weapon items in the gun build and 2 in the spirit build, against 4 and 3 without it). The bias was not tuned against the validation numbers.
9. **Minimum pick rate 5%.** Items bought in fewer than 5% of a hero's matches are not candidates, unless the relaxation ladder needs them to reach 12 items. Rarely bought items have noisy win rates.
10. **Ability order is data-driven, so the three builds share it.** The style only breaks near-ties (`ability.styleTilt`), and for Infernus it never does. Later points rest on few matches (for example 775 of 14,730 matches back the full 16-point path); the UI shows the support and flags points past the data.
11. **Validation covers Infernus only**, as the brief says. Other heroes show a note instead of badges.
12. **Zergggy may be in the aggregate data.** He plays at a rank above the floor, so some of his matches are probably among the 31,000 Infernus matches. The generator still never reads his data or his account, but the aggregate is not guaranteed free of his games, so the agreement is a sanity check and not a clean out-of-sample test.
13. **Personalization annotates, it does not change picks**, because the brief limits the generator's match-data inputs to the aggregate snapshots.
14. **One inline tooltip icon is missing.** One image referenced in an item's text returns 404 at the source. The fetch script records it and the app leaves the icon out, so the page never asks the network for it.
15. **Images are copied locally** (405 files), so the app makes no request to any other host.
16. **Published as a public GitHub Pages site.** GitHub Pages on a free plan needs a public repository, so the source and the site are both public. They carry the same snapshot as a local run, including your match rows for account 267836488 (`player/match-history.json`) and the reference player's 30 matches. The public Deadlock API returns the same rows for those accounts.

## Project layout

```
.github/workflows/deploy.yml   builds and publishes the site to GitHub Pages
scripts/fetch-data.mjs     downloads the snapshots
scripts/generate.ts        prints generated builds (npm run generate)
scripts/validate.ts        prints the validation report (npm run validate)
scripts/check.ts           data, isolation, determinism and README checks (npm run check)
scripts/e2e.mjs            browser acceptance test (npm run e2e)
scripts/lib/               snapshot reader for Node, README parameter-table writer
src/generator/             the generator: evidence, item model, power model, builder, abilities, params
src/validation/            core set and agreement; the only code that reads the reference snapshot
src/personalization/       the "Your pace" numbers and per-purchase estimates
src/data/                  snapshot loading and assets helpers (image paths, text cleanup, stat lines)
src/components/            UI: hero picker, buy list, ability order, item card, validation panel
public/data/               the snapshots (written by fetch-data, read by the app)
```
