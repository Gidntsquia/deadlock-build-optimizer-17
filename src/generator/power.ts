/**
 * Power model: how strong a set of owned items makes this hero, in three dimensions.
 *
 *   gun     sustained bullet damage per second (fire rate, magazine, reload, weapon damage, per-level growth)
 *   spirit  sustained ability damage per second (ability base + spirit-power scaling, cooldowns, durations,
 *           charges, and gun-coupled damage-over-time such as a burn that builds up per bullet)
 *   ehp     effective health (health, resists, barriers, sustain)
 *
 * The item scorer asks "how much does adding this item raise a weighted sum of ln(gun), ln(spirit), ln(ehp)
 * and utility, per 1000 souls of net cost?". That is the "stat value per soul" term.
 */
import type { SlotType } from '../types';
import { addStats, emptyStats, type ItemModel, type Stats } from './itemModel';
import { categoryBonus, levelAt, type KitProfile } from './kit';
import type { GeneratorParams, PowerWeights } from './params';
import { clamp } from './util';

export interface PowerState {
  innate: Stats;
  conditional: Stats;
  procDps: number;
  barrier: number;
  cc: string[];
  spend: Record<SlotType, number>;
}

export interface PowerReading {
  level: number;
  spiritPower: number;
  gunDps: number;
  spiritDps: number;
  ehp: number;
  utility: number;
}

/** Builds a state from three item lists so a gain can be measured piece by piece (stats, then spend, then effects). */
function composeState(innateFrom: ItemModel[], spendFrom: ItemModel[], effectsFrom: ItemModel[]): PowerState {
  const s: PowerState = { innate: emptyStats(), conditional: emptyStats(), procDps: 0, barrier: 0, cc: [], spend: { weapon: 0, vitality: 0, spirit: 0 } };
  for (const m of innateFrom) addStats(s.innate, m.innate);
  for (const m of spendFrom) s.spend[m.slot] += m.cost;
  for (const m of effectsFrom) {
    addStats(s.conditional, m.conditional);
    s.procDps += m.procDps;
    s.barrier += m.barrier;
    for (const k of m.cc) if (!s.cc.includes(k)) s.cc.push(k);
  }
  return s;
}

const CC_WEIGHT: Record<string, number> = { stun: 1.2, silence: 1.0, root: 1.0, slow: 0.8, disarm: 0.8 };

export function readPower(profile: KitProfile, st: PowerState, params: GeneratorParams, netWorth: number): PowerReading {
  const t = (k: keyof Stats): number => st.innate[k] + st.conditional[k];
  const level = levelAt(profile, netWorth);

  const bonusWeapon = categoryBonus(profile, 'weapon', st.spend.weapon);
  const bonusVitality = categoryBonus(profile, 'vitality', st.spend.vitality);
  const bonusSpirit = categoryBonus(profile, 'spirit', st.spend.spirit);

  const spiritPower = (profile.growth.techPower * level + t('spiritPower') + bonusSpirit) * (1 + t('spiritPowerPct') / 100);

  // ---- gun
  const w = profile.weapon;
  const bulletShred = 1 + (t('bulletShredPct') / 100) * 0.8;
  const perBullet =
    ((w.bulletDamage + level * profile.growth.bulletDamage) * (1 + (t('weaponDmgPct') + bonusWeapon) / 100) + t('headshotDmg') * params.headshotRate) * bulletShred;
  const bps = w.bulletsPerSecond * (1 + t('fireRatePct') / 100);
  const mag = w.clip * (1 + t('clipPct') / 100);
  const tEmpty = mag / bps;
  const gunDps = ((perBullet * mag) / (tEmpty + w.reload)) * params.accuracy;

  // ---- spirit
  const cdr = t('cdrPct') / 100;
  const durMult = 1 + t('techDurationPct') / 100;
  const spiritShred = 1 + (t('spiritShredPct') / 100) * 0.8;
  let dps = 0;
  for (const a of profile.abilities) {
    if (a.damage.length === 0) continue;
    const sp = spiritPower + (a.hasCharges ? t('chargedSpirit') : 0);
    const dur = Math.max(1, (a.duration ?? 0) * durMult);
    if (a.buildUpPerHit != null) {
      // gun-coupled: bullets that hit build up the effect; once full it burns for `dur` seconds
      const hitsPerSecond = bps * params.accuracy;
      const timeToProc = 1 / Math.max(1e-6, hitsPerSecond * a.buildUpPerHit);
      const uptime = dur / (timeToProc + dur);
      for (const d of a.damage) {
        const v = d.base + d.scale * sp;
        dps += d.perSecond ? v * uptime : v / (timeToProc + dur);
      }
      continue;
    }
    let perCast = 0;
    for (const d of a.damage) {
      const v = d.base + d.scale * sp;
      perCast += d.perSecond ? v * dur : v;
    }
    if (a.cooldown) {
      const cut = clamp(cdr + (a.ultimate ? t('ultCdrPct') / 100 : 0) + (a.hasCharges ? t('chargedCdrPct') / 100 : 0), 0, params.maxCdr);
      const charges = a.hasCharges ? a.charges + t('extraCharges') : 1;
      const cycle = Math.max((a.cooldown * (1 - cut)) / charges, a.duration ? dur : 0, params.minCycleS);
      dps += perCast / cycle;
    } else {
      dps += perCast / 10;
    }
  }
  const spiritDps = (dps + st.procDps) * spiritShred;

  // ---- effective health
  const hp = (profile.baseHealth + level * profile.growth.health) * (1 + bonusVitality / 100) + t('health');
  const resBullet = clamp(t('bulletResistPct') / 100, 0, 0.8);
  const resTech = clamp(t('techResistPct') / 100, 0, 0.8);
  const taken = 1 - (params.bulletShare * resBullet + (1 - params.bulletShare) * resTech);
  const sustain =
    ((t('bulletLifestealPct') / 100) * gunDps + (t('spiritLifestealPct') / 100) * spiritDps + t('healthRegen')) * params.fightS + st.barrier;
  const ehp = (hp + sustain) / taken;

  // ---- utility (ln-units, small): crowd control and mobility
  let cc = 0;
  for (const k of st.cc) cc += CC_WEIGHT[k] ?? 0.5;
  const mobility = clamp(t('moveSpeed') / 2, 0, 2) + clamp(t('statusResistPct') / 40, 0, 1);
  const utility = params.utilityUnit * (Math.min(cc, 3) + mobility);

  return { level, spiritPower, gunDps, spiritDps, ehp, utility };
}

/** Weighted ln-power. Differences of this between two readings are "ln-power gained". */
export function powerScore(r: PowerReading, w: PowerWeights): number {
  return w.aGun * Math.log(Math.max(r.gunDps, 1e-6)) + w.aSpirit * Math.log(1 + r.spiritDps) + w.aSurv * Math.log(r.ehp) + w.aUtil * r.utility;
}

export interface PowerGain {
  total: number;
  /** innate stats only */
  stats: number;
  /** soul-investment threshold bonuses */
  threshold: number;
  /** passives, actives, procs, barriers, crowd control */
  effects: number;
}

/**
 * Gain from buying `add` while giving up `remove` (the components an upgrade consumes), evaluated at one fixed
 * net worth so level growth cancels out. Stats, soul-investment thresholds and effects are added one after the
 * other so the total can be split into named parts.
 */
export function gainFromChange(profile: KitProfile, owned: ItemModel[], add: ItemModel, remove: ItemModel[], params: GeneratorParams): PowerGain {
  const after = [...owned.filter((o) => !remove.includes(o)), add];
  const netWorth = after.reduce((sum, m) => sum + m.cost, 0) + params.unspentSouls;
  const read = (innate: ItemModel[], spend: ItemModel[], effects: ItemModel[]): number =>
    powerScore(readPower(profile, composeState(innate, spend, effects), params, netWorth), params.weights);
  const p0 = read(owned, owned, owned);
  const p1 = read(after, owned, owned);
  const p2 = read(after, after, owned);
  const p3 = read(after, after, after);
  return { total: p3 - p0, stats: p1 - p0, threshold: p2 - p1, effects: p3 - p2 };
}
