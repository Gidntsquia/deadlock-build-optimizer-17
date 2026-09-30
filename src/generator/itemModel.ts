/**
 * Turns a catalog item (assets API tooltip data) into numbers the power model can use.
 *
 * - "innate" tooltip sections are permanent stats and count in full.
 * - passive and active sections count at an uptime (duration / cooldown during a fight, or a stated default).
 * - damage procs become damage per second; barriers and heals become effective health; crowd control and
 *   mobility become flags.
 */
import type { CatalogItem, SlotType, TooltipSection } from '../types';
import type { GeneratorParams } from './params';
import { clamp, num } from './util';

export type StatKey =
  | 'health'
  | 'healthRegen'
  | 'weaponDmgPct'
  | 'fireRatePct'
  | 'clipPct'
  | 'headshotDmg'
  | 'rangePct'
  | 'bulletLifestealPct'
  | 'spiritPower'
  | 'spiritPowerPct'
  | 'cdrPct'
  | 'ultCdrPct'
  | 'techRangePct'
  | 'techDurationPct'
  | 'spiritLifestealPct'
  | 'extraCharges'
  | 'chargedSpirit'
  | 'chargeRecoveryPct'
  | 'chargedCdrPct'
  | 'bulletResistPct'
  | 'techResistPct'
  | 'statusResistPct'
  | 'moveSpeed'
  | 'bulletShredPct'
  | 'spiritShredPct';

export const STAT_KEYS: StatKey[] = [
  'health',
  'healthRegen',
  'weaponDmgPct',
  'fireRatePct',
  'clipPct',
  'headshotDmg',
  'rangePct',
  'bulletLifestealPct',
  'spiritPower',
  'spiritPowerPct',
  'cdrPct',
  'ultCdrPct',
  'techRangePct',
  'techDurationPct',
  'spiritLifestealPct',
  'extraCharges',
  'chargedSpirit',
  'chargeRecoveryPct',
  'chargedCdrPct',
  'bulletResistPct',
  'techResistPct',
  'statusResistPct',
  'moveSpeed',
  'bulletShredPct',
  'spiritShredPct',
];

export type Stats = Record<StatKey, number>;

export function emptyStats(): Stats {
  const s = {} as Stats;
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
}

export function addStats(into: Stats, add: Partial<Stats>, factor = 1): void {
  for (const k of STAT_KEYS) {
    const v = add[k];
    if (v) into[k] += v * factor;
  }
}

/** Tooltip property name -> stat, and how much of the printed number counts. */
const STAT_OF: Record<string, [StatKey, number]> = {
  BonusHealth: ['health', 1],
  BonusBaseHealth: ['health', 1],
  BonusHealthRegen: ['healthRegen', 1],
  OutOfCombatHealthRegen: ['healthRegen', 0.25],
  Regeneration: ['healthRegen', 1],
  BaseAttackDamagePercent: ['weaponDmgPct', 1],
  CloseRangeBonusWeaponPower: ['weaponDmgPct', 0.5],
  LongRangeBonusWeaponPower: ['weaponDmgPct', 0.5],
  BonusFireRate: ['fireRatePct', 1],
  ActiveBonusFireRate: ['fireRatePct', 1],
  FervorFireRate: ['fireRatePct', 1],
  BonusClipSizePercent: ['clipPct', 1],
  HeadShotBonusDamage: ['headshotDmg', 1],
  BonusAttackRangePercent: ['rangePct', 1],
  BulletLifestealPercent: ['bulletLifestealPct', 1],
  TechPower: ['spiritPower', 1],
  SpiritPower: ['spiritPower', 1],
  SpiritPowerInnate: ['spiritPower', 1],
  BonusSpirit: ['spiritPower', 1],
  TechPowerPercent: ['spiritPowerPct', 1],
  CooldownReduction: ['cdrPct', 1],
  UltimateCooldownReduction: ['ultCdrPct', 1],
  TechRangeMultiplier: ['techRangePct', 1],
  BonusAbilityDurationPercent: ['techDurationPct', 1],
  AbilityLifestealPercentHero: ['spiritLifestealPct', 1],
  AbilityLifestealPercentHeroPassive: ['spiritLifestealPct', 1],
  BonusAbilityCharges: ['extraCharges', 1],
  BonusSpiritForChargedAbilities: ['chargedSpirit', 1],
  CooldownBetweenChargeReduction: ['chargeRecoveryPct', 1],
  CooldownReductionOnChargedAbilities: ['chargedCdrPct', 1],
  BulletResist: ['bulletResistPct', 1],
  TechResist: ['techResistPct', 1],
  StatusResistancePercent: ['statusResistPct', 1],
  InnateStatusResistancePercent: ['statusResistPct', 1],
  FervorStatusResistancePercent: ['statusResistPct', 1],
  BonusMoveSpeed: ['moveSpeed', 1],
  ActiveBonusMoveSpeed: ['moveSpeed', 1],
  FervorMovespeed: ['moveSpeed', 1],
  BonusSprintSpeed: ['moveSpeed', 0.5],
  // enemy resist reductions: the tooltip prints them negative
  BulletArmorReduction: ['bulletShredPct', -1],
  BulletResistReduction: ['bulletShredPct', -1],
  MagicResistReduction: ['spiritShredPct', -1],
  TechArmorDamageReduction: ['spiritShredPct', -1],
};

/** Keys that are permanent even when printed in a passive section. */
const ALWAYS_ON = new Set(['CooldownReduction', 'UltimateCooldownReduction']);

const DAMAGE_NAMES = new Set([
  'Damage',
  'SpiritDamage',
  'ProcBonusMagicDamage',
  'DamagePerChain',
  'ExplosionDamage',
  'DPS',
  'BonusDamage',
  'ProcBonusDamage',
  'TotalDamage',
]);

const HEAL_NAMES = new Set(['TotalHealthRegen', 'HealPercentAmount']);
const BARRIER_NAMES = new Set(['CombatBarrier']);
const DURATION_NAMES = ['AbilityDuration', 'BuffDuration', 'Duration', 'EffectDuration'];

const CC_FLAGS: Record<string, string> = {
  StatusEffectStun: 'stun',
  StatusEffectEMP: 'silence',
  StatusEffectDisarmed: 'disarm',
  StatusEffectImmobilize: 'root',
  StatusEffectSleep: 'stun',
  StatusEffectSilence: 'silence',
  FreezeDuration: 'slow',
  SlowPercent: 'slow',
  MovementSpeedSlow: 'slow',
  FireRateSlow: 'slow',
};

export interface ItemModel {
  id: number;
  item: CatalogItem;
  name: string;
  slot: SlotType;
  tier: number;
  cost: number;
  isActive: boolean;
  /** catalog ids of direct components (items this one upgrades) */
  componentIds: number[];
  /** permanent stats from innate sections */
  innate: Stats;
  /** passive/active stats already multiplied by their uptime */
  conditional: Stats;
  /** damage per second from passive/active damage effects (uptime-weighted) */
  procDps: number;
  /** flat barrier plus heal, per fight (effective health) */
  barrier: number;
  /** crowd-control kinds this item applies */
  cc: string[];
  cooldown: number | null;
  duration: number | null;
  /** short labels for the innate stats, for explanations */
  statLines: string[];
}

const STAT_LABEL: Record<StatKey, [string, string]> = {
  health: ['', ' Health'],
  healthRegen: ['', ' Health Regen'],
  weaponDmgPct: ['%', ' Weapon Damage'],
  fireRatePct: ['%', ' Fire Rate'],
  clipPct: ['%', ' Ammo'],
  headshotDmg: ['', ' Headshot Damage'],
  rangePct: ['%', ' Weapon Range'],
  bulletLifestealPct: ['%', ' Bullet Lifesteal'],
  spiritPower: ['', ' Spirit Power'],
  spiritPowerPct: ['%', ' Spirit Power'],
  cdrPct: ['%', ' Cooldown Reduction'],
  ultCdrPct: ['%', ' Ultimate Cooldown Reduction'],
  techRangePct: ['%', ' Ability Range'],
  techDurationPct: ['%', ' Ability Duration'],
  spiritLifestealPct: ['%', ' Spirit Lifesteal'],
  extraCharges: ['', ' Ability Charge'],
  chargedSpirit: ['', ' Spirit Power on charged abilities'],
  chargeRecoveryPct: ['%', ' Charge Recovery'],
  chargedCdrPct: ['%', ' Cooldown Reduction on charged abilities'],
  bulletResistPct: ['%', ' Bullet Resist'],
  techResistPct: ['%', ' Spirit Resist'],
  statusResistPct: ['%', ' Debuff Resist'],
  moveSpeed: ['', ' Move Speed'],
  bulletShredPct: ['%', ' enemy Bullet Resist shred'],
  spiritShredPct: ['%', ' enemy Spirit Resist shred'],
};

export function formatStat(key: StatKey, value: number): string {
  const [unit, label] = STAT_LABEL[key];
  const v = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${v > 0 ? '+' : ''}${v}${unit}${label}`;
}

function sectionNames(section: TooltipSection): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const attr of section.section_attributes ?? []) {
    for (const list of [attr.properties, attr.elevated_properties, attr.important_properties]) {
      for (const n of list ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          out.push(n);
        }
      }
    }
  }
  return out;
}

function firstValue(item: CatalogItem, names: string[], pool: string[]): number | null {
  for (const n of names) {
    if (pool.includes(n)) {
      const v = num(item.properties?.[n]?.value, NaN);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

export function buildItemModel(item: CatalogItem, idByClass: Map<string, number>, params: GeneratorParams): ItemModel {
  const innate = emptyStats();
  const conditional = emptyStats();
  let procDps = 0;
  let barrier = 0;
  const cc = new Set<string>();
  let cooldown: number | null = null;
  let duration: number | null = null;
  const props = item.properties ?? {};

  for (const section of item.tooltip_sections ?? []) {
    const kind = section.section_type ?? 'none';
    const names = sectionNames(section);

    if (kind === 'innate') {
      for (const n of names) {
        const map = STAT_OF[n];
        if (!map) continue;
        const v = num(props[n]?.value, NaN);
        if (Number.isFinite(v)) innate[map[0]] += v * map[1];
      }
      continue;
    }

    // passive / active / unlabeled sections
    const secCooldown = firstValue(item, ['AbilityCooldown'], names);
    const secDuration = firstValue(item, DURATION_NAMES, names);
    if (secCooldown != null && (cooldown == null || secCooldown < cooldown)) cooldown = secCooldown;
    if (secDuration != null && (duration == null || secDuration > duration)) duration = secDuration;

    const isActiveSection = kind === 'active';
    let uptime: number;
    let perFight = 1;
    if (secCooldown != null) {
      perFight = clamp(45 / secCooldown, 0.2, 1);
      uptime = secDuration != null ? clamp(secDuration / params.fightS, 0.05, 1) * perFight : (isActiveSection ? params.activeUptime : params.passiveUptime) * perFight;
    } else {
      uptime = isActiveSection ? params.activeUptime : params.passiveUptime;
    }

    for (const n of names) {
      const cck = CC_FLAGS[n];
      if (cck) cc.add(cck);
      const map = STAT_OF[n];
      const raw = num(props[n]?.value, NaN);
      if (map && Number.isFinite(raw)) {
        const u = ALWAYS_ON.has(n) ? 1 : uptime;
        conditional[map[0]] += raw * map[1] * u;
        continue;
      }
      if (!Number.isFinite(raw)) continue;
      if (DAMAGE_NAMES.has(n)) {
        let total = raw;
        if (n === 'DPS') total = raw * (secDuration ?? 4);
        if (n === 'DamagePerChain') total = raw * Math.max(1, num(props.ChainCount?.value, 1) * 0.5);
        procDps += secCooldown != null ? total / Math.max(secCooldown, params.minCycleS) : total * 0.1;
      } else if (BARRIER_NAMES.has(n) || HEAL_NAMES.has(n)) {
        const amount = n === 'HealPercentAmount' ? raw * 15 : raw;
        barrier += amount * perFight * (secCooldown != null ? 1 : 0.6);
      }
    }
  }

  const statLines: string[] = [];
  for (const k of STAT_KEYS) {
    if (innate[k] !== 0 && k !== 'healthRegen') statLines.push(formatStat(k, innate[k]));
  }

  return {
    id: item.id,
    item,
    name: item.name,
    slot: item.item_slot_type,
    tier: item.item_tier,
    cost: item.cost,
    isActive: Boolean(item.is_active_item),
    componentIds: (item.component_items ?? []).map((c) => idByClass.get(c)).filter((x): x is number => x != null),
    innate,
    conditional,
    procDps,
    barrier,
    cc: [...cc].sort(),
    cooldown,
    duration,
    statLines,
  };
}

export function buildItemModels(catalog: CatalogItem[], params: GeneratorParams): Map<number, ItemModel> {
  const idByClass = new Map<string, number>();
  for (const it of catalog) idByClass.set(it.class_name, it.id);
  const out = new Map<number, ItemModel>();
  for (const it of [...catalog].sort((a, b) => a.id - b.id)) {
    out.set(it.id, buildItemModel(it, idByClass, params));
  }
  return out;
}
