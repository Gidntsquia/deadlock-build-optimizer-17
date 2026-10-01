/**
 * Item selection: scores candidates, fills the phase plan greedily, orders purchases and computes net cost and
 * the running soul total.
 *
 * The build is a list of purchases. A purchase is either a new item or an upgrade that consumes components
 * already owned (the game credits their price). The final inventory always ends up with `plan` total new items.
 *
 * score(item | build so far, phase) =
 *     w.win    * winLift / winLiftScale * reliability(pickRate)     win-rate evidence (buy-time adjusted)
 *   + w.pick   * min(pickRate / pickRateCap, 1)                       usage evidence
 *   + w.power  * compress(ln-power gained per 1000 net souls / ref)   stat value per soul, split into
 *                                                                     stats / thresholds / passives+actives
 *   + w.kit    * kitFit                                               hero-kit specific fit
 *   + w.pair   * mean pair lift with the items it would sit next to   permutation stats
 *   + w.timing * how far the typical buy time is outside the phase    game phase
 */
import type { BuildItem, PhaseId, SlotType, TermContribution } from '../types';
import type { ItemEvidence, PairIndex } from './evidence';
import type { ItemModel } from './itemModel';
import type { KitProfile } from './kit';
import type { GeneratorParams, PhasePlanStep, PhaseWeights } from './params';
import { gainFromChange, type PowerGain } from './power';
import { clamp, fmtSouls } from './util';

export interface BuilderContext {
  profile: KitProfile;
  params: GeneratorParams;
  models: Map<number, ItemModel>;
  evidence: Map<number, ItemEvidence>;
  pairs: PairIndex;
  budget: number;
  heroName: string;
  /** developer aid: called with every scored candidate of each selection round */
  trace?: (round: { phase: PhaseId; chosen: Pick; candidates: Pick[] }) => void;
}

export interface Pick {
  model: ItemModel;
  ev: ItemEvidence;
  phase: PhaseId;
  kind: 'new' | 'upgrade';
  /** owned items this purchase consumes */
  consumes: number[];
  /** price after credit for the consumed items */
  netCost: number;
  score: number;
  terms: TermContribution[];
  gain: PowerGain;
  pair: number;
  pairWith: number | null;
}

const PHASES: PhaseId[] = ['early', 'mid', 'late'];
const phaseIndex = (p: PhaseId): number => PHASES.indexOf(p);

export function compress(x: number): number {
  return x / (1 + Math.abs(x) / 4);
}

// ------------------------------------------------------------------ kit fit, timing

interface KitRelevance {
  charges: number;
  range: number;
  ccGap: number;
  dot: boolean;
  gunCoupled: boolean;
}

function kitRelevance(profile: KitProfile): KitRelevance {
  const n = Math.max(1, profile.abilities.length);
  return {
    charges: profile.abilities.filter((a) => a.hasCharges || a.upgradeAddsCharges).length / n,
    range: profile.abilities.filter((a) => a.scalesRange).length / n,
    ccGap: profile.summary.crowdControl ? 0.3 : 1,
    dot: profile.summary.dot,
    gunCoupled: profile.summary.gunCoupled,
  };
}

function kitFit(m: ItemModel, rel: KitRelevance): number {
  const has = (k: keyof ItemModel['innate']): boolean => m.innate[k] + m.conditional[k] > 0;
  let v = 0;
  if (has('chargedSpirit') || has('extraCharges') || has('chargeRecoveryPct') || has('chargedCdrPct')) v += 0.8 * rel.charges;
  if (has('techRangePct')) v += 0.6 * rel.range;
  if (m.cc.length > 0) v += 0.5 * rel.ccGap;
  if (rel.dot && m.procDps > 0) v += 0.3;
  if (rel.gunCoupled && (has('fireRatePct') || has('clipPct'))) v += 0.4;
  return v;
}

function timingTerm(ev: ItemEvidence, phase: PhaseId, params: GeneratorParams): number {
  if (ev.avgBuyTimeS == null) return 0;
  const [lo, hi] = params.phaseWindowS[phase];
  const dist = ev.avgBuyTimeS < lo ? lo - ev.avgBuyTimeS : ev.avgBuyTimeS > hi ? ev.avgBuyTimeS - hi : 0;
  return -Math.min(1.5, dist / 300);
}

// ------------------------------------------------------------------ upgrade graph

/** Transitive components of every item (what it is built from). */
function componentClosure(models: Map<number, ItemModel>): Map<number, Set<number>> {
  const down = new Map<number, Set<number>>();
  const visit = (id: number): Set<number> => {
    const hit = down.get(id);
    if (hit) return hit;
    const out = new Set<number>();
    down.set(id, out);
    for (const c of models.get(id)?.componentIds ?? []) {
      out.add(c);
      for (const d of visit(c)) out.add(d);
    }
    return out;
  };
  for (const id of [...models.keys()].sort((a, b) => a - b)) visit(id);
  return down;
}

/**
 * How a candidate relates to the inventory: a plain new item, an upgrade of owned components, or unusable
 * (already owned, already built into something owned, or only related through a deeper component).
 */
function classify(m: ItemModel, owned: ItemModel[], down: Map<number, Set<number>>): { kind: 'new' | 'upgrade'; consumes: ItemModel[] } | null {
  const below = down.get(m.id) ?? new Set<number>();
  const direct: ItemModel[] = [];
  for (const o of owned) {
    if (o.id === m.id) return null;
    if (down.get(o.id)?.has(m.id)) return null;
    if (m.componentIds.includes(o.id)) direct.push(o);
    else if (below.has(o.id)) return null;
  }
  return { kind: direct.length > 0 ? 'upgrade' : 'new', consumes: direct };
}

// ------------------------------------------------------------------ selection

interface Relaxation {
  anyTier: boolean;
  phaseSlotCap: boolean;
  minMatches: number;
  minPickRate: number;
  budgetSlack: number;
}

function relaxations(params: GeneratorParams): Relaxation[] {
  const base = { minMatches: params.minMatches, minPickRate: params.minPickRate, budgetSlack: 0 };
  return [
    { anyTier: false, phaseSlotCap: true, ...base },
    { anyTier: true, phaseSlotCap: true, ...base },
    { anyTier: true, phaseSlotCap: false, ...base },
    { anyTier: true, phaseSlotCap: false, minMatches: params.fallback.minMatches, minPickRate: params.fallback.minPickRate, budgetSlack: params.fallback.budgetSlack },
  ];
}

export function selectPicks(ctx: BuilderContext): Pick[] {
  const { profile, params, models, evidence, pairs } = ctx;
  const rel = kitRelevance(profile);
  const down = componentClosure(models);

  const pool: { model: ItemModel; ev: ItemEvidence }[] = [];
  for (const id of [...evidence.keys()].sort((a, b) => a - b)) {
    const model = models.get(id);
    const ev = evidence.get(id)!;
    if (!model || !model.item.shopable || model.item.disabled) continue;
    if (ev.matches < params.fallback.minMatches || ev.pickRate < params.fallback.minPickRate) continue;
    pool.push({ model, ev });
  }

  // cheapest item the normal thresholds allow in each step, used to keep room in the budget for later picks
  const stepFloor = (step: PhasePlanStep): number => {
    let floor = Infinity;
    for (const { model, ev } of pool) {
      if (ev.matches < params.minMatches || ev.pickRate < params.minPickRate) continue;
      if (model.tier < step.minTier || model.tier > step.maxTier) continue;
      floor = Math.min(floor, model.cost);
    }
    return Number.isFinite(floor) ? floor : 0;
  };
  const newFloors: number[] = params.plan.flatMap((step) => Array.from({ length: step.count }, () => stepFloor(step)));
  const ladder = relaxations(params);

  const history: Pick[] = [];
  let owned: ItemModel[] = [];
  let spent = 0;
  let sizeTarget = 0;

  for (const step of params.plan) {
    const w: PhaseWeights = params.phaseWeights[step.phase];
    const phaseNew: Record<SlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
    let upgradesInStep = 0;
    // the plan counts items in the final inventory: an upgrade that merges two owned items frees a slot again
    sizeTarget += step.count;

    while (owned.length < sizeTarget) {
      let best: Pick | null = null;
      const considered: Pick[] = [];
      for (const relax of ladder) {
        for (const { model, ev } of pool) {
          if (ev.matches < relax.minMatches || ev.pickRate < relax.minPickRate) continue;
          const cls = classify(model, owned, down);
          if (!cls) continue;
          if (cls.kind === 'upgrade' && upgradesInStep >= step.maxUpgrades) continue;
          if (!relax.anyTier && (cls.kind === 'new' ? model.tier < step.minTier : false)) continue;
          if (!relax.anyTier && model.tier > step.maxTier) continue;

          // inventory limits after the purchase
          const slotAfter: Record<SlotType, number> = { weapon: 0, vitality: 0, spirit: 0 };
          for (const o of owned) if (!cls.consumes.includes(o)) slotAfter[o.slot]++;
          slotAfter[model.slot]++;
          if (slotAfter[model.slot] > params.maxPerSlot) continue;
          if (cls.kind === 'new' && relax.phaseSlotCap && phaseNew[model.slot] >= step.maxPerSlot) continue;
          const activesAfter = owned.filter((o) => !cls.consumes.includes(o) && o.isActive).length + (model.isActive ? 1 : 0);
          if (model.isActive && activesAfter > params.maxActives) continue;

          const credit = cls.consumes.reduce((s, o) => s + o.cost, 0);
          const netCost = Math.max(0, model.cost - credit);
          const reserve = newFloors.slice(Math.max(0, owned.length + 1 - cls.consumes.length)).reduce((s, f) => s + f, 0);
          if (spent + netCost + reserve > ctx.budget * (1 + relax.budgetSlack)) continue;

          const gain = gainFromChange(profile, owned, model, cls.consumes, params);
          const soulsK = Math.max(netCost, 200) / 1000;
          const powerValue = compress(gain.total / soulsK / params.powerRefPerK);
          const split = (part: number): number => (Math.abs(gain.total) > 1e-9 ? (powerValue * part) / gain.total : powerValue / 3);

          const reliability = Math.sqrt(Math.min(1, ev.pickRate / params.reliablePickRate));
          const win = clamp(ev.winLift / params.winLiftScale, -2.5, 2.5) * reliability;
          const pick = Math.min(ev.pickRate / params.pickRateCap, 1);
          const kit = kitFit(model, rel);

          // pair synergy with the items it will sit next to (not with the ones it replaces)
          const partners = owned.filter((o) => !cls.consumes.includes(o));
          let pair = 0;
          let pairWith: number | null = null;
          if (partners.length > 0) {
            let sum = 0;
            let top = 0;
            for (const p of partners) {
              const l = pairs.lift(model.id, p.id) / params.pairLiftScale;
              sum += l;
              if (l > top) {
                top = l;
                pairWith = p.id;
              }
            }
            pair = clamp(sum / partners.length, -1.5, 1.5);
          }
          const timing = timingTerm(ev, step.phase, params);

          const terms: TermContribution[] = [
            { term: 'win rate', value: w.win * win },
            { term: 'usage', value: w.pick * pick },
            { term: 'stat value per soul', value: w.power * split(gain.stats) },
            { term: 'soul thresholds', value: w.power * split(gain.threshold) },
            { term: 'passives & actives', value: w.power * split(gain.effects) },
            { term: 'kit fit', value: w.kit * kit },
            { term: 'pair synergy', value: w.pair * pair },
            { term: 'timing', value: w.timing * timing },
          ];
          const score = terms.reduce((s, t) => s + t.value, 0);
          const cand: Pick = { model, ev, phase: step.phase, kind: cls.kind, consumes: cls.consumes.map((o) => o.id), netCost, score, terms, gain, pair, pairWith };
          if (ctx.trace) considered.push(cand);
          const better = !best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && model.id < best.model.id);
          if (better) best = cand;
        }
        if (best) break;
      }
      const chosen = best as Pick | null;
      if (!chosen) break;
      ctx.trace?.({ phase: step.phase, chosen, candidates: considered });

      history.push(chosen);
      owned = [...owned.filter((o) => !chosen.consumes.includes(o.id)), chosen.model];
      spent += chosen.netCost;
      if (chosen.kind === 'new') phaseNew[chosen.model.slot]++;
      else upgradesInStep++;
    }
  }
  return history;
}

// ------------------------------------------------------------------ ordering, stones, totals

function phaseOfTime(t: number, params: GeneratorParams): PhaseId {
  if (t < params.phaseWindowS.early[1]) return 'early';
  if (t < params.phaseWindowS.mid[1]) return 'mid';
  return 'late';
}

interface Purchase {
  model: ItemModel;
  /** typical buy time in seconds, raised where needed so an upgrade comes after its components */
  key: number;
  pick: Pick | null;
}

/** Adds stones, orders everything, and computes net cost and running totals. */
export function planPurchases(ctx: BuilderContext, picks: Pick[]): BuildItem[] {
  const { params, models, evidence } = ctx;
  const consumedByPick = new Set<number>(picks.flatMap((p) => p.consumes));
  const pickedIds = new Set(picks.map((p) => p.model.id));
  const defaultTime = (phase: PhaseId): number => (phase === 'early' ? 300 : phase === 'mid' ? 840 : 1680);

  const purchases: Purchase[] = [];
  const keyOf = new Map<number, number>();
  for (const p of picks) {
    let key = p.ev.avgBuyTimeS ?? defaultTime(p.phase);
    for (const c of p.consumes) key = Math.max(key, (keyOf.get(c) ?? 0) + 1);
    keyOf.set(p.model.id, key);
    purchases.push({ model: p.model, key, pick: p });
  }

  // components the picks were not built from: buy the popular ones early and upgrade them
  const stones = new Set<number>();
  const finals = picks.filter((p) => !consumedByPick.has(p.model.id));
  for (const f of [...finals].sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase) || a.model.id - b.model.id)) {
    if (f.phase === 'early') continue;
    for (const cid of f.model.componentIds) {
      if (stones.size >= params.stones.max) break;
      const cm = models.get(cid);
      const ev = evidence.get(cid);
      if (!cm || !cm.item.shopable || cm.item.disabled || !ev) continue;
      if (pickedIds.has(cid) || stones.has(cid)) continue;
      if (ev.pickRate < params.stones.minPickRate || cm.tier > params.stones.maxTier) continue;
      const parentKey = keyOf.get(f.model.id)!;
      const own = ev.avgBuyTimeS ?? parentKey - 600;
      stones.add(cid);
      purchases.push({ model: cm, key: Math.min(own, parentKey - 1), pick: null });
    }
  }

  // one time order for the whole list; the early / mid / late heading of each row follows its buy time
  purchases.sort((a, b) => a.key - b.key || a.model.id - b.model.id);

  const owned = new Set<number>();
  const consumedBy = new Map<number, number>();
  let running = 0;
  const out: BuildItem[] = [];
  for (const p of purchases) {
    const consumes: number[] = [];
    let credit = 0;
    for (const cid of p.model.componentIds) {
      if (owned.has(cid)) {
        consumes.push(cid);
        credit += models.get(cid)?.cost ?? 0;
        owned.delete(cid);
        consumedBy.set(cid, p.model.id);
      }
    }
    const netCost = Math.max(0, p.model.cost - credit);
    running += netCost;
    owned.add(p.model.id);
    const ev = p.pick?.ev ?? evidence.get(p.model.id);
    out.push({
      itemId: p.model.id,
      name: p.model.name,
      slot: p.model.slot,
      tier: p.model.tier,
      phase: phaseOfTime(p.key, params),
      role: 'final',
      cost: p.model.cost,
      netCost,
      running,
      consumes,
      upgradedInto: null,
      evidence: {
        matches: ev?.matches ?? 0,
        winRate: ev?.winRate ?? 0,
        pickRate: ev?.pickRate ?? 0,
        winLift: ev?.winLift ?? 0,
        avgBuyTimeS: ev?.avgBuyTimeS ?? null,
      },
      score: p.pick?.score ?? 0,
      terms: p.pick?.terms ?? [],
      reasons: [],
    });
  }
  for (const it of out) {
    it.upgradedInto = consumedBy.get(it.itemId) ?? null;
    if (it.upgradedInto != null) it.role = 'component';
  }
  for (const it of out) {
    const pick = picks.find((f) => f.model.id === it.itemId) ?? null;
    it.reasons = explain(ctx, it, pick, out);
  }
  return out;
}

const pct = (x: number, d = 0): string => `${(x * 100).toFixed(d)}%`;

function explain(ctx: BuilderContext, it: BuildItem, pick: Pick | null, all: BuildItem[]): string[] {
  const m = ctx.models.get(it.itemId)!;
  const reasons: string[] = [];
  const nameOf = (id: number): string => ctx.models.get(id)?.name ?? `item ${id}`;
  if (it.upgradedInto != null) {
    reasons.push(`Bought for ${fmtSouls(it.cost)} souls, then upgraded into ${nameOf(it.upgradedInto)}; its price counts toward the upgrade.`);
  }
  if (it.consumes.length > 0) {
    reasons.push(`Upgrade of ${it.consumes.map(nameOf).join(' and ')}: costs ${fmtSouls(it.netCost)} souls instead of ${fmtSouls(it.cost)}.`);
  }
  const ev = pick?.ev;
  if (!pick) {
    reasons.push(`Bought in ${pct(it.evidence.pickRate)} of ${ctx.heroName} games.`);
    return reasons;
  }
  const liftPts = ev!.winLift * 100;
  reasons.push(
    `Bought in ${pct(ev!.pickRate)} of ${ctx.heroName} games; win rate ${pct(ev!.winRate, 1)} (${liftPts >= 0 ? '+' : ''}${liftPts.toFixed(1)} pts against items bought at the same time).`,
  );
  if (m.statLines.length > 0) reasons.push(`Stats: ${m.statLines.slice(0, 3).join(', ')}.`);
  const top = [...pick.terms].sort((a, b) => b.value - a.value)[0];
  if (top && top.value > 0.5 && top.term !== 'usage' && top.term !== 'win rate') reasons.push(`Strongest factor: ${top.term}.`);
  if (pick.pairWith != null && pick.pair > 0.3) {
    const other = all.find((x) => x.itemId === pick.pairWith);
    if (other) reasons.push(`Players who own both this and ${other.name} win more than either item alone predicts.`);
  }
  const thr = pick.terms.find((t) => t.term === 'soul thresholds');
  if (thr && thr.value > 0.4) reasons.push(`Pushes ${it.slot} spending past a soul-investment bonus.`);
  return reasons;
}
