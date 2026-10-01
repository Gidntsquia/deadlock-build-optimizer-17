# Deadlock Build Optimizer

A mobile-first web app that builds an item list for any Deadlock hero from real aggregate data: how often each item is bought, how often the buyer wins, what it costs, what it does, and how the hero's kit scales. Each hero gets one build: an ordered buy list (early / mid / late, with a running soul total) plus an ability level-up order. Tap any item for a detail card.

Infernus is the default hero and the only one tuned and validated. The other 37 active heroes generate and render from the same code, but nothing was tuned for them.

The app is a static site (React 18, Vite, TypeScript). It has no backend, database, login or paid service. It reads JSON snapshots that `npm run fetch-data` writes from the public [Deadlock API](https://api.deadlock-api.com), so after one fetch it works offline. The look follows the in-game build screen: a teal window header, a parchment body, paper item cards and a navy ability chart. Text is set in Figtree, bundled with the app (`@fontsource-variable/figtree`), so no font is loaded from the network.

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
| `npm run generate` | Prints the generated build for Infernus (or `-- 2 5` for other hero ids, `-- --all` for every hero, `-- --json`), with the determinism hashes. |
| `npm run validate` | Prints the Infernus validation report (core set and agreement). |
| `npm run check` | Verifies the data and code-level acceptance criteria (see "Verification"). `-- --live` also compares the catalog with the live API; `-- --write-docs` regenerates the parameter tables below. |
| `npm run e2e` | Builds with the network off, serves `dist/`, and drives headless Chromium at 390×844 and 1280×800 through the UI acceptance criteria. Needs a Chromium in the Playwright cache (`npx playwright-core install chromium`). |

### Live site (GitHub Pages)

The app is published at https://gidntsquia.github.io/deadlock-build-optimizer-17/. `.github/workflows/deploy.yml` runs `npm ci` and `npm run build` on every push to `main` (or by hand from the Actions tab) and publishes `dist/`. The build needs no network, because the snapshot is committed in `public/data`, and the relative `base` in `vite.config.ts` makes the app work under the `/deadlock-build-optimizer-17/` sub-path.

To refresh the live data: run `npm run fetch-data`, commit `public/data`, and push. Pages is switched on in the repository settings with Source set to "GitHub Actions".

## What you see

- **Hero picker** (top bar): all active heroes, searchable. The hero is kept in the address (`#hero=<id>`), so a link opens that hero.
- **One build per hero**: there are no tabs or styles to choose between. The hero's own kit and data decide the item mix.
- **Summary**: total souls, final items, purchases, spend by slot type, and (Infernus) the agreement % with the reference player.
- **Buy list**: grouped early / mid / late, drawn as cards like the in-game build screen. Each card has the item art, a roman-numeral tier tag in the top corner (purple spirit, green vitality, orange weapon), the name on a band, the price, the running soul total, and a core / not-core badge (Infernus). A light band means a core item (or no validation data for that hero); a dark band means not core. A dashed outline marks a stepping stone: a component the build buys early and later upgrades, listed as its own purchase because you really spend those souls. Active items carry an ACTIVE chip.
- **Ability order**: the in-game "Ability Point Order" chart. One row per ability (icon at the left, rows in ability-slot order), one column per point, 1 to 16, read left to right. A purple bolt marks the point that unlocks the ability; a diamond numbered 1, 2 or 3 marks that upgrade tier. Points after the recorded sequences end have a dashed outline. Below the chart, one card per ability lists its unlock and upgrade points and what the upgrades do.
- **Validation**: how well the generator did against the reference player (see "Validation").
- **Item card** (tap any item anywhere, including the chips for "Built from" and "Upgrades into"): shop image, cost, tier, slot type, stat lines, and passive / active text, all from the assets data. On a phone it is a bottom sheet; on a desktop it is centered.

Layout: phone first (checked at 390×844, 360 and 320 wide), tap targets at least 40 px, and on wide screens a centered 600 px column.

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
| `zergggy/match-history-infernus.json`, `zergggy/purchases-infernus.json` | Validation data only: the reference player's Infernus match list, and the item purchases of his 30 most recent real matchmaking Infernus matches (see "Validation"). |
| `img/` and `img/manifest.json` | Local copies of every image the app shows (shop images, ability icons, hero portraits, inline tooltip icons). The manifest maps the remote URL to the local file. |

Window and filters for all aggregate analytics: matches since the latest patch (kept between 7 and 30 days; 13.9 days at the last fetch), average badge 70 or higher ("Emissary and above"), ranked and unranked matchmaking, normal game mode. Requests are paced at about two per second and retried on HTTP 429 and 5xx, well inside the API's shared limit.

## How builds are generated

`src/generator/` is a pure function: `generateBuild(inputs, params)`. Same snapshot and same parameters give the same build, byte for byte. There is no randomness and no clock, and every tie is broken by item id (see "Determinism").

**Inputs.** Match data: only the aggregate analytics snapshots listed above (`item-stats`, `ability-order`, `permutation-stats`, plus `hero-stats` for the hero's match count, win rate and average final net worth). Everything else is assets data: the item catalog and the hero's kit. The generator does not read the reference player's data.

**Scoring.** Each candidate purchase gets a score given the items already chosen and the game phase:

```
score(item | owned items, phase) =
    w.win    · clamp(winLift / winLiftScale, ±2.5) · sqrt(min(1, pickRate / reliablePickRate))
  + w.pick   · min(pickRate / pickRateCap, 1)
  + w.power  · compress(ln-power gained per 1,000 net souls / powerRefPerK)
  + w.kit    · kitFit(item, hero kit)
  + w.pair   · clamp(mean pair lift with the owned items / pairLiftScale, ±1.5)
  + w.timing · -min(1.5, seconds outside the phase's buy window / 300)

w = phaseWeights[phase]      compress(x) = x / (1 + |x| / 4)
```

| Term | What it measures | Where it comes from |
| --- | --- | --- |
| win rate | Win rate of the item's buyers minus the win rate of players who bought other items at about the same time (Gaussian kernel, `baselineBandwidthS`), pulled toward that baseline by `shrinkMatches`. Raw win rates are biased: expensive items are bought late, in games that last, by the team that is ahead. | item-stats |
| usage | Share of the hero's matches where the item was bought. | item-stats, hero-stats |
| stat value per soul | How much the item raises a weighted sum of ln(gun damage/s), ln(spirit damage/s), ln(effective health) and a small utility term, per 1,000 souls of net cost. The four weights (`weights`) are the same for every hero, so the hero's own weapon and abilities decide which stats pay off. Stats that scale per level use the hero's growth values. | assets (catalog, kit) |
| soul thresholds | The extra power from pushing a slot's total spend past a soul-investment bonus step (the hero's `cost_bonuses`). | assets (kit) |
| passives & actives | Damage procs become damage per second, barriers and heals become effective health, crowd control and mobility become utility. Effects count at an uptime. With a stated cooldown: effect duration ÷ `fightS` (or `passiveUptime` / `activeUptime` if no duration is stated), times 45 s ÷ cooldown, kept between 0.2 and 1. With no cooldown: `passiveUptime` or `activeUptime`. A few always-on stats count in full. | assets (catalog) |
| kit fit | Extra credit when an item feeds something the hero's abilities use. Charge items get 0.8 × the share of the hero's abilities that have charges; range items 0.6 × the share that scale with range; crowd-control items 0.5 (0.15 when the hero already has crowd control); damage procs 0.3 when the hero's kit deals damage over time; fire rate or magazine 0.4 when an ability is coupled to the gun (Infernus's Afterburn). | assets (kit) |
| pair synergy | Win rate of players who own both items minus what the two items predict separately, shrunk by sample size; averaged over the owned items the new item will sit next to (not the ones it replaces). | permutation-stats |
| timing | Penalty when the item's typical buy time falls outside the phase's window. | item-stats |

**Power model.** `src/generator/power.ts` reads the hero's weapon (damage, rate of fire, magazine, reload), per-level growth and ability damage, then computes sustained gun damage per second, sustained spirit damage per second and effective health for a set of owned items, at the build's net worth plus `unspentSouls`. For Infernus this includes Afterburn: bullets that hit build up a burn, so fire rate and accuracy raise burn uptime, and spirit power and duration raise its damage. Gains are measured at one fixed net worth, so level growth cancels. The three readings and a utility term are combined with one set of weights (`weights`: gun 0.5, spirit 0.5, survivability 0.6, utility 0.3), the same for every hero; there is no per-hero or per-style setting.

**Selection.** The build is filled greedily in three phases of final items (early 4, mid 5, late 3 = 12 final items). The plan limits item tier per phase, items of one slot type per phase and in the inventory, and active items held at once. The total is held under a budget: `budgetShare` (90%) of the hero's average final net worth. If no candidate passes the normal limits, a four-step relaxation ladder retries: first the normal limits, then without the tier limits, then also without the per-phase slot cap, then also with the lower match-count and pick-rate floors (`fallback`) and up to 10% over budget. That is how every hero reaches 12 items.

**Upgrades and net cost.** An item built from components can be bought as an upgrade: it consumes the owned components and is credited their price, so it costs less. Running totals use that net cost. "Stepping stones" (popular cheap components the build buys early and upgrades later) are added to the buy list, so the buy order matches how the game's shop is used. The buy list is in one order, by each item's average buy time in the data (raised where needed so an upgrade comes after the components it consumes). The early / mid / late heading on a row follows its buy time (before 10 minutes is early, before 21 minutes is mid, later is late), so it can differ from the stage the item was picked in.

**Ability order.** `src/generator/abilities.ts` walks the recorded ability-point sequences as a tree, one point at a time. At each point it takes the branch with the best shrunk win rate among branches that keep at least `ability.minBranchShare` of the matches at that point. The first point put into an ability is labelled "Unlock"; the later ones are upgrade tiers 1 to 3. The result is always 16 points. Points past what the data supports (few matches last that long) are filled in and flagged "no data this far" in the UI, and the build shows how many matches back each stretch of the order.

### Parameters and weights

Every tunable number the generator uses is in `src/generator/params.ts` with a doc comment. The tables below are generated from that file by `npm run check -- --write-docs`, and `npm run check` fails if they drift.

A few constants are fixed in the code, not in `params.ts`, and appear in the formula above: the `compress` divisor 4, the win-lift score clamp ±2.5, the pair score clamp ±1.5, the timing scale (300 s per point, capped at 1.5), the kit-fit values in the table above, and a 200-soul floor on an item's net cost in the per-soul power term (so a nearly free upgrade does not score infinity).

<!-- params:begin (generated by `npm run check -- --write-docs`, do not edit by hand) -->

**Evidence**

| Parameter | Default | Meaning |
| --- | --- | --- |
| `minMatches` | 150 | items below this many matches for the hero are not candidates |
| `minPickRate` | 0.25 | items bought in fewer than this share of the hero's matches are not candidates |
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
| `weights.aGun` | 0.5 | weight on ln(gun damage per second) |
| `weights.aSpirit` | 0.5 | weight on ln(1 + spirit damage per second) |
| `weights.aSurv` | 0.6 | weight on ln(effective health) |
| `weights.aUtil` | 0.3 | weight on utility (crowd control, mobility) |

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
| `ability.affinityTilt` | 0.01 | win-rate points (fraction) added per unit of damage-scaling affinity, to break near-ties |

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
| early | 4 | 1 | 2 | 2 | 2 |
| mid | 5 | 2 | 3 | 3 | 3 |
| late | 3 | 3 | 5 | 3 | 3 |

- `count`: final items picked in this phase
- `minTier`: lowest tier of a newly bought (not upgraded) item in this phase
- `maxTier`: highest tier of any pick in this phase
- `maxPerSlot`: at most this many new picks from the same slot type inside the phase
- `maxUpgrades`: upgrades of items already owned (they consume the component) allowed in this phase, on top of `count`

<!-- params:end -->

### Determinism

`generateBuild` depends only on the snapshot and the parameters. Two runs in one process, and two separate Node processes, give identical JSON (`npm run check` does both; `npm run generate` prints `deterministic=true` and two hashes). For the 2026-09-30 snapshot: generator version 1.2.0, parameters hash `1600bb30f1af27`, Infernus build hash `0df88b1477ea6f`. A new fetch changes the data, so the build hash changes with it; the parameters hash changes only when you edit the parameters.

## Validation against the reference player

Validation is a separate step that runs after generation. It compares the generated build with the actual Infernus item choices of the top player Zergggy (account 35187362). The generator never reads his data. For the first run (generator 1.0.0, which made three builds) it was a clean **held-out** test and nothing was tuned. It is no longer clean: I then raised the agreement by tuning the generator (1.1.0), and I chose the weights of the single build (1.2.0) with his score on screen. "Tuning pass" and "One build" below say what was tuned on and what that does to the number.

**Sample.** His 30 most recent real matchmaking Infernus matches (unranked or ranked, normal mode, no abandons; private lobbies and bot modes are excluded). Per match, the items he bought and when. At fetch time: 20 of the 30 were wins.

**Core set, and what counts as an experiment.** An item is **core** when it shows up in **at least 30% of his sampled matches**, where each won match counts 1.5 times ("shows up" = bought at any time in the match). Items below 30% are **experiments**: his one-off builds are excluded from the core set. The 2026-09-30 sample gives 27 core items and 33 experiments.

**Agreement.** For the generated build:

```
agreement = 0.7 · overlap + 0.3 · order concordance

overlap            = F1 of precision (share of the build's items that are core)
                     and recall (share of the core items the build contains)
order concordance  = among items in both the build and the core set, the share of item pairs
                     that the build buys in the same order as his median first-buy times
                     (ties count half; with fewer than two shared items, overlap alone is used)
```

Every recommended item carries a core / not-core badge (an item he never bought in the sample is "not core · 0/30"), the build shows its agreement, and the validation panel lists the core items, the excluded experiments and the numbers. It is shown as "how well the generator did", not as a source of the build.

**First run** (2026-09-30 snapshot, generator 1.0.0, parameters frozen before the run, nothing tuned). Version 1.0.0 still made three builds, one per style:

| Build | Agreement | Overlap (precision / recall) | Order |
| --- | ---: | --- | ---: |
| Gun Damage | 72.2% | 68% (80% / 59%) | 82% |
| Spirit & Burn | 66.0% | 61% (74% / 52%) | 78% |
| Hybrid | 73.2% | 70% (84% / 59%) | 82% |

**Tuning pass (generator 1.1.0).** To raise the agreement without using his data, I tuned on other players. The tuning set is the Infernus matches since the latest patch of 84 top-of-the-leaderboard players (1,411 matches). The 40 players with at least 15 matches each get their own core set by the same 30% rule, and are split by account id into two groups, A (19 players) and B (21 players). A build's score on a group is its mean agreement over the players. Settings were chosen by the A and B mean. That data lives outside the repository and no player from it is named here. The generator does not read it: it only informed three changes:

- `minPickRate` 0.05 → 0.25. Items bought in under a quarter of the hero's matches are no longer candidates. Agreement with the tuning players rose when the candidates were limited to popular items.
- Phase plan 3 / 5 / 4 → 4 / 5 / 3 final items (early / mid / late). In the tuning set the median player makes 6 purchases by minute 10, 13 by minute 21 and 18 in all (11 of them never sold), in a median 35 minute match.
- One buy order for the list, by typical buy time, instead of listing each pick stage in turn (see "How builds are generated").

I also tried raising the rank floor of the aggregate data to badge 90, 100 and 105. Agreement was lower with each.

| Mean over the three builds | 1.0.0 | 1.1.0 |
| --- | ---: | ---: |
| Other players, group A | 65.1 | 73.2 |
| Other players, group B | 69.0 | 76.0 |
| Zergggy | 70.5 | 73.4 |

In 1.1.0 his three builds scored 76.2% (Gun Damage), 72.9% (Hybrid) and 71.0% (Spirit & Burn).

**One build (generator 1.2.0).** The app now makes one build per hero. The slot-type bonus is gone and the power model uses one set of weights for every hero (gun 0.5, spirit 0.5, survivability 0.6, utility 0.3), so each hero's kit and data decide the item mix. Across the 38 heroes the 12 final items hold 0 to 6 weapon items, and 3.2 weapon, 4.0 vitality and 4.7 spirit items on average.

I chose the weights on all 38 heroes, not on his data. For each hero I scored the build against a "community core": the items bought in at least 30% of that hero's matches in the aggregate data, wins counted 1.5 times. That is the same rule as above, applied to everyone instead of one player. Eight weight sets scored 87.5 to 88.3 on that measure, and the mean win rate of their final items was 51.92% to 51.97%, so the choice matters little. 0.5 / 0.5 / 0.6 scored highest (88.3). Then I checked it on Infernus: it picks the same 12 final items as the 1.1.0 Gun Damage build, the best of the three, so the Infernus scores are the same:

| | Zergggy | Group A | Group B |
| --- | ---: | ---: | ---: |
| Mean of the three 1.1.0 builds | 73.4 | 73.2 | 76.0 |
| 1.1.0 Gun Damage build | 76.2 | 74.1 | 77.2 |
| 1.2.0 single build | 76.2 | 74.1 | 77.2 |

His 1.2.0 build scores **76.2%**: overlap 74% (precision 89%, recall 63%), order 82%.

What these numbers are and are not:

- **No number after the first run is a clean out-of-sample result.** Groups A and B chose the 1.1.0 settings, and I saw his score when I checked the 1.2.0 weights on Infernus. In 1.1.0 I used his score only as a guard against a drop, and no change was rejected because of it. His gain from 1.0.0 to 1.1.0 (70.5 → 73.4, the mean of the three builds) is some sign that the improvement is not just fitted to A and B. It is not proof.
- **Group A and B scores are close to the ceiling for a list this long.** A list built from the items other top players treat as core, scored against players left out of that consensus, gets about 74 to 79. Choosing different items has little left to give. Getting closer to one player needs that player's own data, and the generator must not read it.
- **The cost is a bit of win rate and more conventional builds.** The mean aggregate win rate of the final items is 51.95% across the 38 heroes (Infernus 48.8%), against 52.9% (Infernus 49.9%) in 1.0.0. In 1.0.0, 540 of the 1,368 final items (3 builds of 12 for each of 38 heroes) were below a 25% pick rate; in 1.2.0, 7 of the 456 are. Every hero's build reaches 12 final items and stays within its budget.

The build contains 63% of his core items (recall), and 89% of what it contains is core (precision). 17 of his 27 core items are in it. Ten are not: Headshot Booster, Suppressor, Healbane, Spirit Shielding, Weapon Shielding, Mystic Shot, Headhunter, Counterspell, Scourge and Warp Stone. I did not change the generator to pick up any of his specific items.

**Isolation, and how it is checked.** In the app and generator code, only `src/validation/index.ts` reads the reference snapshot. The fetch script writes it, and the two test scripts (`check`, `e2e`) read it to verify the results. `npm run check` follows the import graph of `src/generator/index.ts` and `src/data/snapshots.ts`, fails if it reaches the validation code or contains `zergggy`, `35187362` or `purchases-infernus`, and then generates builds for every hero with a file reader that throws if the generator asks for any path containing `zergggy`. You can also run `grep -rniE "zergggy|35187362|purchases-infernus" src/generator src/data`; it prints nothing.

## Verification

`npm run check` and `npm run e2e` test behavior and data shape, never specific item names, because live data changes daily. Results on the 2026-09-30 snapshot:

| Acceptance criterion | How it is checked | Result |
| --- | --- | --- |
| `fetch-data` writes the snapshots: item catalog with at least 200 shopable items, per-hero analytics for every active hero, at least 20 Zergggy matches with purchase data | `check` reads the snapshots; `check --live` compares them with the live API | **Gap on the first item**: the API lists 250 items and 173 are shopable (see judgment call 1). Analytics for all 38 heroes; 30 validation matches (552 purchase records). |
| With snapshots present and the network off, `npm run build` succeeds and the served app renders with no console errors | `e2e` re-runs itself in an empty network namespace (`unshare -rn`), confirms the network is down, builds, serves `dist/`, loads the app, and fails on any console error or warning, page error, failed request, HTTP error or non-local request | Pass |
| Opens on Infernus with a build of 12+ items grouped early / mid / late with cost and running total, and each item shows its correct shop image | `e2e` | Pass: one build with 19 purchases (12 final items), no tabs; every image checked against the catalog's shop image |
| Any 3 other heroes generate and render without errors | `e2e` (picks 3 through the picker, then all 38 heroes) | Pass: 38 heroes, one build each, 686 purchases |
| The build shows an ability sequence with the 4 real Infernus names, unlock order and upgrade tiers | `e2e` | Pass: 16 points; each ability has a first point and upgrades 1 to 3 |
| Tapping any item opens a card with image, cost, tier, slot type and stat / ability text matching the assets data | `e2e` opens every recommended item of every hero (123 distinct items) and the chip links, and compares each card with `catalog.json` | Pass |
| Every recommended item has a core / not-core badge, the build has an agreement %, and the README states the 30% rule | `e2e` recomputes the core set and the agreement from the raw snapshot and compares with the page; `check` checks this README | Pass |
| The generator imports only the aggregate snapshots; only the validation module reads the reference snapshot | `check` (import graph, text search, guarded reader; see "Isolation") | Pass |
| At 390×844 there is no horizontal scrolling on any screen, and all controls stay tappable | `e2e` measures every screen state (builds, item cards, picker, expanded lists): page width, every element's box, clipped text, and each control's size and whether another element covers it | Pass: no overflow; every control at least 40×40 px |
| This README documents the scoring inputs and weights, and rerunning the generator on the same snapshot gives an identical build | `check` compares the parameter tables with the code and runs the generator twice in-process and in two separate processes | Pass |

## Judgment calls

I built this without being able to ask, so these are the decisions I made. Each is easy to change.

1. **Only 173 shopable items, not 200 or more.** The catalog has 250 upgrade items, but the API marks only 173 as `shopable` (the other 77 are disabled). I did not pad the count. The catalog snapshot keeps all 250 items; the generator only recommends shopable, enabled ones. `npm run check` reports this as a gap instead of failing.
2. **API host moved.** The old `assets.deadlock-api.com/v2` no longer answers; assets now live at `https://api.deadlock-api.com/v1/assets/...`. The fetch script uses the new path.
3. **Data window and rank floor.** Aggregates cover matches since the latest patch (7 to 30 days back), average badge 70 or higher, ranked and unranked normal games. A fresh patch changes the meta, and a rank floor keeps the signal close to how a top player plays while leaving about 31,000 Infernus matches. Both are options on the fetch script.
4. **Corrupted items** are excluded from the analytics, which is the API default.
5. **Builds hold 12 final items, and the buy list also shows components.** The brief asks for a buy list of 12 or more items. A build is 12 final items (early 4, mid 5, late 3); purchases of components that are later upgraded are listed too, since they cost souls and come in the order you buy them (19 rows for Infernus).
6. **Soul-investment bonuses are read as running totals.** The hero's `cost_bonuses` rise at each threshold (Infernus weapon: 9, 12, 15, 18, 46, …), so the bonus at a spend is the highest step reached, not a sum of steps.
7. **Tooltip sections without a type are treated as passive**, and effects without a stated duration or cooldown use a fixed uptime (`passiveUptime` 0.4, `activeUptime` 0.25). These are guesses, documented in the parameters.
8. **One build per hero, with no style setting.** The first versions made three builds (Gun Damage, Spirit & Burn, Hybrid), separated by power-model weights and a score bonus per slot type. They overlapped a lot (in 1.1.0 the Gun Damage and Spirit & Burn builds shared 8 of 12 final items), and Spirit & Burn agreed least with every group of players I compared against. I replaced them with one build and one set of power weights for every hero (see "Validation", "One build"). The weights were picked on all 38 heroes and then checked on Infernus, so they are tuned to Infernus data to a degree. For the other heroes they are a neutral default: the hero's kit decides how much gun damage, spirit damage and survivability pay off.
9. **Minimum pick rate 25%.** Items bought in fewer than a quarter of a hero's matches are not candidates, unless the relaxation ladder needs them to reach 12 items. It was 5% in version 1.0.0. I raised it in the tuning pass because it lifted agreement with other top players (see "Validation"). The price is builds that follow the crowd: the final items' mean aggregate win rate is about one point lower, and an unusual item with a good win rate has to clear the bar of being popular first. Rarely bought items also have noisy win rates, which the floor keeps out.
10. **Ability order is data-driven.** `ability.affinityTilt` only breaks near-ties between branches, and it changes the order for 3 of the 38 heroes (not Infernus). Later points rest on few matches (for example 775 of 14,730 matches back the full 16-point path); the UI shows the support and flags points past the data.
11. **Validation covers Infernus only**, as the brief says. Other heroes show a note instead of badges.
12. **Zergggy may be in the aggregate data.** He plays at a rank above the floor, so some of his matches are probably among the 31,000 Infernus matches. The generator still never reads his data or his account, but the aggregate is not guaranteed free of his games, so the agreement is a sanity check and not a clean out-of-sample test.
13. **Versions 1.1.0 and 1.2.0 were tuned with Zergggy's score on screen.** 1.1.0 was tuned on other top players' matches, and the 1.2.0 weights on the aggregate data of all 38 heroes. In 1.1.0 I used his score only as a guard against a drop, and no change was rejected because of it. In 1.2.0 I saw it when I checked the chosen weights on Infernus. So his 76.2% is not a clean out-of-sample number (see "Validation"). The tuning data is not in the repository.
14. **One inline tooltip icon is missing.** One image referenced in an item's text returns 404 at the source. The fetch script records it and the app leaves the icon out, so the page never asks the network for it.
15. **Images are copied locally** (405 files), so the app makes no request to any other host.
16. **Published as a public GitHub Pages site.** GitHub Pages on a free plan needs a public repository, so the source and the site are both public. They carry the same snapshot as a local run, including the reference player's 30 matches. The public Deadlock API returns the same rows for that account.
17. **The ability chart numbers the upgrades 1, 2, 3.** The in-game chart puts 1, 2 and 5 on its upgrade chips. The snapshot has no ability-point cost data, so the app shows the upgrade tier instead. Switching the labels to 1 / 2 / 5 is a small change in `src/components/AbilityOrder.tsx`.

## Project layout

```
.github/workflows/deploy.yml   builds and publishes the site to GitHub Pages
scripts/fetch-data.mjs     downloads the snapshots
scripts/generate.ts        prints the generated build (npm run generate)
scripts/validate.ts        prints the validation report (npm run validate)
scripts/check.ts           data, isolation, determinism and README checks (npm run check)
scripts/e2e.mjs            browser acceptance test (npm run e2e)
scripts/lib/               snapshot reader for Node, README parameter-table writer
src/generator/             the generator: evidence, item model, power model, builder, abilities, params
src/validation/            core set and agreement; the only code that reads the reference snapshot
src/data/                  snapshot loading and assets helpers (image paths, text cleanup, stat lines)
src/components/            UI: hero picker, buy list (item cards), ability order chart, item card, validation panel
src/styles.css             the whole look: colour tokens, parchment and paper textures, cards, chart
public/data/               the snapshots (written by fetch-data, read by the app)
```
