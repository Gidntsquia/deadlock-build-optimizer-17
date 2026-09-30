/**
 * Ability level-up order from the aggregate ability-order snapshot.
 *
 * Each snapshot row is a full sequence of ability points (one character per point, indexing `abilityIds`)
 * with wins and losses. The plan walks that prefix tree one point at a time. At each point it picks the
 * branch with the best shrunk win rate among branches that keep a meaningful share of the matches.
 * The first time an ability appears is its unlock; later appearances are upgrade tiers 1 to 3.
 * Matches rarely last long enough to spend every point, so the last points of the path are filled in
 * (in unlock order) and flagged `beyondData`; the UI shows them as "after the sampled data ends".
 */
import type { AbilityOrderSnapshot, AbilityPlan, AbilityPoint, HeroKit } from '../types';
import type { KitProfile } from './kit';
import type { GeneratorParams, StyleDef } from './params';

interface Row {
  seq: string;
  wins: number;
  n: number;
}

function digit(c: string): number {
  return parseInt(c, 36);
}

export function planAbilities(snapshot: AbilityOrderSnapshot, kit: HeroKit, profile: KitProfile, style: StyleDef, params: GeneratorParams): AbilityPlan {
  const ids = snapshot.abilityIds ?? [];
  const nameOf = new Map<number, string>(kit.abilities.map((a) => [a.id, a.name]));
  const all: Row[] = (snapshot.rows ?? [])
    .filter(([seq, w, l]) => seq.length > 0 && w + l > 0)
    .map(([seq, w, l]) => ({ seq, wins: w, n: w + l }))
    .sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));

  const totalMatches = all.reduce((s, r) => s + r.n, 0);

  // target length: the longest prefix that at least half of the matches reach
  const byLen = new Map<number, number>();
  for (const r of all) byLen.set(r.seq.length, (byLen.get(r.seq.length) ?? 0) + r.n);
  const lens = [...byLen.keys()].sort((a, b) => b - a);
  let target = lens.length ? lens[lens.length - 1] : 0;
  let reach = 0;
  for (const len of lens) {
    reach += byLen.get(len) ?? 0;
    if (reach >= totalMatches * 0.5) {
      target = len;
      break;
    }
  }
  const rows = all.filter((r) => r.seq.length >= target);

  // style affinity per ability index, only used to break near-ties
  const scaleSum = (idx: number): number => {
    const a = profile.abilities.find((x) => x.id === ids[idx]);
    return a ? a.damage.reduce((s, d) => s + d.scale, 0) : 0;
  };
  const totalScale = ids.reduce((s, _id, i) => s + scaleSum(i), 0) || 1;
  const coupled = profile.abilities.filter((a) => a.buildUpPerHit != null).length || 1;
  const affinity = (idx: number): number => {
    const a = profile.abilities.find((x) => x.id === ids[idx]);
    if (!a) return 0;
    return style.aSpirit * (scaleSum(idx) / totalScale) + style.aGun * (a.buildUpPerHit != null ? 1 / coupled : 0);
  };

  let prefix = '';
  for (let pos = 0; pos < target; pos++) {
    const acc = new Map<string, { wins: number; n: number }>();
    let prefixWins = 0;
    let prefixN = 0;
    for (const r of rows) {
      if (!r.seq.startsWith(prefix)) continue;
      const c = r.seq[pos];
      const e = acc.get(c) ?? { wins: 0, n: 0 };
      e.wins += r.wins;
      e.n += r.n;
      acc.set(c, e);
      prefixWins += r.wins;
      prefixN += r.n;
    }
    if (prefixN === 0) break;
    const prefixWr = prefixWins / prefixN;
    let best: { c: string; score: number; n: number } | null = null;
    let widest: { c: string; n: number } | null = null;
    for (const c of [...acc.keys()].sort()) {
      const e = acc.get(c)!;
      if (!widest || e.n > widest.n) widest = { c, n: e.n };
      if (e.n < params.ability.minBranchShare * prefixN) continue;
      const shrunk = (e.wins + params.ability.shrinkMatches * prefixWr) / (e.n + params.ability.shrinkMatches);
      const score = shrunk + params.ability.styleTilt * affinity(digit(c));
      if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && e.n > best.n)) best = { c, score, n: e.n };
    }
    prefix += (best ?? widest!).c;
  }

  // points
  const points: AbilityPoint[] = [];
  const seen = new Map<number, number>();
  const push = (abilityId: number, beyond = false): void => {
    const count = seen.get(abilityId) ?? 0;
    seen.set(abilityId, count + 1);
    points.push({
      point: points.length + 1,
      abilityId,
      abilityName: nameOf.get(abilityId) ?? `Ability ${abilityId}`,
      kind: count === 0 ? 'unlock' : 'upgrade',
      tier: count,
      ...(beyond ? { beyondData: true } : {}),
    });
  };
  for (const c of prefix) {
    const id = ids[digit(c)];
    if (id != null) push(id);
  }
  // every ability gets an unlock even if the most common path reaches it late ...
  const signature = kit.abilities.filter((x) => /^signature/.test(x.slot ?? 'signature'));
  for (const a of signature) {
    if (!seen.has(a.id)) push(a.id, true);
  }
  // ... and finishes its upgrade tiers. Points past what the sampled matches reached are marked `beyondData`.
  const unlocked = points.filter((p) => p.kind === 'unlock').map((p) => p.abilityId);
  for (const id of unlocked) {
    const tiers = signature.find((a) => a.id === id)?.upgrades.length ?? 3;
    while ((seen.get(id) ?? 0) - 1 < tiers) push(id, true);
  }

  const unlockOrder = points.filter((p) => p.kind === 'unlock').map((p) => p.abilityId);
  const perAbility = unlockOrder.map((id) => ({
    abilityId: id,
    name: nameOf.get(id) ?? `Ability ${id}`,
    unlockPoint: points.find((p) => p.abilityId === id && p.kind === 'unlock')!.point,
    upgradePoints: points.filter((p) => p.abilityId === id && p.kind === 'upgrade').map((p) => p.point),
  }));

  const pathMatches = [4, 8, 12, prefix.length].map((len) => {
    const p = prefix.slice(0, Math.min(len, prefix.length));
    return rows.reduce((s, r) => (r.seq.startsWith(p) ? s + r.n : s), 0);
  });

  return { points, unlockOrder, perAbility, support: { pathMatches, sequencesConsidered: rows.length, totalMatches } };
}
