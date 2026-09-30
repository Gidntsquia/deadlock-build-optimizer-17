/**
 * Reads a hero's kit (assets API) into the numbers the power model needs:
 * weapon stats, per-level growth, ability damage scaling, category soul-investment bonuses, level curve.
 */
import type { AbilityInfo, HeroKit, KitSummary, SlotType } from '../types';
import { clamp, num } from './util';

export interface AbilityDamage {
  name: string;
  base: number;
  /** spirit-power coefficient (assets `stat_scale`) */
  scale: number;
  perSecond: boolean;
}

export interface AbilityModel {
  id: number;
  name: string;
  ultimate: boolean;
  cooldown: number | null;
  /** base duration of the damage-over-time / effect window, before duration bonuses */
  duration: number | null;
  hasCharges: boolean;
  charges: number;
  damage: AbilityDamage[];
  /** fraction of a full build-up added per bullet hit; set for abilities driven by the hero's gun */
  buildUpPerHit: number | null;
  scalesRange: boolean;
  scalesDuration: boolean;
  scalesCooldown: boolean;
  crowdControl: boolean;
  upgradeAddsCharges: boolean;
}

export interface WeaponModel {
  bulletDamage: number;
  bulletsPerSecond: number;
  clip: number;
  reload: number;
  shotsPerSecond: number;
}

export interface KitProfile {
  heroId: number;
  heroName: string;
  weapon: WeaponModel;
  growth: { techPower: number; bulletDamage: number; health: number };
  baseHealth: number;
  abilities: AbilityModel[];
  costBonuses: Record<SlotType, { threshold: number; bonus: number }[]>;
  /** cumulative souls needed to reach level index+1 */
  levels: number[];
  summary: KitSummary;
}

const DURATION_PROPS = ['BurnDuration', 'GroundFlameDuration', 'AbilityDuration', 'BuffDuration', 'DebuffDuration', 'EffectDuration', 'Duration'];
const CC_PROPS = ['StunDuration', 'SlowPercent', 'SlowDuration', 'SilenceDuration', 'RootDuration', 'FreezeDuration', 'StatusEffectStun'];

function levelGrowth(kit: HeroKit, key: string): number {
  return num(kit.standard_level_up_upgrades?.[key], 0);
}

function buildAbility(a: AbilityInfo): AbilityModel {
  const props = a.properties ?? {};
  const cooldown = num(props.AbilityCooldown?.value, 0);
  const hasCharges = props.AbilityCharges !== undefined;
  const damage: AbilityDamage[] = [];
  for (const [name, p] of Object.entries(props)) {
    const sf = p.scale_function;
    if (sf?.class_name === 'scale_function_tech_damage') {
      const base = num(p.value, NaN);
      if (Number.isFinite(base)) {
        damage.push({ name, base, scale: num(sf.stat_scale, 0), perSecond: /^(DPS|.*PerSecond)$/.test(name) });
      }
    }
  }
  damage.sort((x, y) => x.name.localeCompare(y.name));
  let duration: number | null = null;
  for (const n of DURATION_PROPS) {
    const v = num(props[n]?.value, 0);
    if (v > 0) {
      duration = v;
      break;
    }
  }
  const buildUp = num(props.BuildUpBulletPercentPerHit?.value, 0);
  const scaleTypes = Object.values(props).map((p) => p.scale_function?.specific_stat_scale_type ?? '');
  const scaleClasses = Object.values(props).map((p) => p.scale_function?.class_name ?? '');
  return {
    id: a.id,
    name: a.name,
    ultimate: a.ability_type === 'ultimate',
    cooldown: cooldown > 0 ? cooldown : null,
    duration,
    hasCharges,
    charges: hasCharges ? Math.max(1, num(props.AbilityCharges?.value, 1)) : 1,
    damage,
    buildUpPerHit: buildUp > 0 ? buildUp / 100 : null,
    scalesRange: scaleTypes.includes('ETechRange') || scaleTypes.includes('ETechRadius'),
    scalesDuration: scaleTypes.includes('ETechDuration') || scaleClasses.includes('scale_function_tech_duration'),
    scalesCooldown: scaleTypes.includes('ETechCooldown'),
    crowdControl: CC_PROPS.some((n) => props[n] !== undefined),
    upgradeAddsCharges: (a.upgrades ?? []).some((u) => (u.property_upgrades ?? []).some((pu) => pu.name === 'AbilityCharges')),
  };
}

export function buildKitProfile(kit: HeroKit): KitProfile {
  const wi = kit.weapon?.weapon_info ?? {};
  const burst = Math.max(1, num(wi.burst_shot_count, 1));
  const bullets = Math.max(1, num(wi.bullets, 1));
  const cycle = Math.max(0.02, num(wi.cycle_time, 0.1));
  const intra = Math.max(0, num(wi.intra_burst_cycle_time, 0));
  const cycleSeconds = cycle + (burst - 1) * intra;
  const shotsPerSecond = burst / cycleSeconds;
  const weapon: WeaponModel = {
    bulletDamage: Math.max(0.1, num(wi.bullet_damage, 6)) * bullets,
    bulletsPerSecond: shotsPerSecond,
    shotsPerSecond,
    clip: Math.max(1, num(wi.clip_size, 20)),
    reload: Math.max(0.2, num(wi.reload_duration, 2)),
  };

  const growth = {
    techPower: levelGrowth(kit, 'MODIFIER_VALUE_TECH_POWER'),
    bulletDamage: levelGrowth(kit, 'MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL') * bullets,
    health: levelGrowth(kit, 'MODIFIER_VALUE_BASE_HEALTH_FROM_LEVEL'),
  };

  const abilities = (kit.abilities ?? [])
    .filter((a) => /^signature/.test(a.slot ?? 'signature'))
    .map(buildAbility);

  const costBonuses = { weapon: [], vitality: [], spirit: [] } as KitProfile['costBonuses'];
  for (const slot of ['weapon', 'vitality', 'spirit'] as SlotType[]) {
    costBonuses[slot] = (kit.cost_bonuses?.[slot] ?? [])
      .map((c) => ({ threshold: num(c.gold_threshold), bonus: num(c.bonus) }))
      .sort((a, b) => a.threshold - b.threshold);
  }

  const levels: number[] = [];
  for (const [lvl, gold] of Object.entries(kit.level_requirements ?? {})) {
    const n = parseInt(lvl, 10);
    if (Number.isFinite(n) && gold != null) levels[n - 1] = num(gold);
  }
  for (let i = 0; i < levels.length; i++) if (levels[i] == null) levels[i] = i > 0 ? levels[i - 1] : 0;

  const baseHealth = num(kit.starting_stats?.max_health, 800);

  // ---- summary for the UI and the README
  const power = (a: AbilityModel) => a.damage.reduce((s, d) => s + d.scale * (d.perSecond ? Math.max(a.duration ?? 1, 1) : 1), 0);
  const totalScale = abilities.reduce((s, a) => s + power(a), 0);
  const spiritDependence = clamp(totalScale / 3, 0, 1);
  const gunCoupled = abilities.some((a) => a.buildUpPerHit != null);
  const dot = abilities.some((a) => a.damage.some((d) => d.perSecond));
  const dps = weapon.bulletDamage * weapon.shotsPerSecond;
  const tEmpty = weapon.clip / weapon.shotsPerSecond;
  const summary: KitSummary = {
    spiritDependence,
    dot,
    gunCoupled,
    charges: abilities.some((a) => a.hasCharges || a.upgradeAddsCharges),
    crowdControl: abilities.some((a) => a.crowdControl),
    abilities: abilities.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.ultimate ? 'ultimate' : a.buildUpPerHit != null ? 'gun-coupled' : a.cooldown ? 'active' : 'passive',
      base: a.damage.reduce((s, d) => s + d.base, 0),
      scale: a.damage.reduce((s, d) => s + d.scale, 0),
      cooldown: a.cooldown,
      coupledToGun: a.buildUpPerHit != null,
    })),
    weapon: { dps, sustainedDps: (dps * tEmpty) / (tEmpty + weapon.reload), reloadShare: weapon.reload / (tEmpty + weapon.reload) },
    growth: { techPowerPerLevel: growth.techPower, bulletDamagePerLevel: growth.bulletDamage, healthPerLevel: growth.health },
  };

  return { heroId: kit.id, heroName: kit.name, weapon, growth, baseHealth, abilities, costBonuses, levels, summary };
}

/** Highest level whose cumulative soul requirement is at most `netWorth`. */
export function levelAt(profile: KitProfile, netWorth: number): number {
  let level = 1;
  for (let i = 0; i < profile.levels.length; i++) {
    if (profile.levels[i] <= netWorth) level = i + 1;
    else break;
  }
  return level;
}

/** Cumulative category bonus (weapon: % weapon damage, vitality: % base health, spirit: spirit power) at a spend. */
export function categoryBonus(profile: KitProfile, slot: SlotType, spend: number): number {
  let bonus = 0;
  for (const c of profile.costBonuses[slot]) {
    if (c.threshold <= spend) bonus = c.bonus;
    else break;
  }
  return bonus;
}
