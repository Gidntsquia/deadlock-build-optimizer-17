import { localImage } from '../data/assets';
import type { AbilityInfo, AbilityPlan, AbilityProperty, HeroKit } from '../types';
import { Html } from './Html';
import { Img } from './Img';
import { useUi } from './context';

function abilityIcon(manifest: Record<string, string>, a: AbilityInfo | undefined): string | undefined {
  if (!a) return undefined;
  return localImage(manifest, a.image_webp) ?? localImage(manifest, a.image);
}

function pretty(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

/** "Ability Charges +1", "Cooldown -12s" ... from a first-tier upgrade entry. */
function upgradeLine(a: AbilityInfo, u: { name: string; bonus: string | number }): string {
  const p: AbilityProperty | undefined = a.properties[u.name];
  const label = p?.label ?? pretty(u.name);
  const bonus = String(u.bonus);
  const signed = /^\d/.test(bonus) ? `+${bonus}` : bonus;
  const postfix = /[a-z%]$/i.test(bonus) ? '' : (p?.postfix ?? '');
  return `${label} ${signed}${postfix}`.trim();
}

const SLOT_NAME: Record<string, string> = { signature1: 'Ability 1', signature2: 'Ability 2', signature3: 'Ability 3', signature4: 'Ultimate' };

export function AbilityOrder({ plan, kit }: { plan: AbilityPlan; kit: HeroKit }) {
  const { app } = useUi();
  const byId = new Map(kit.abilities.map((a) => [a.id, a]));
  const tierLabel = (tier: number): string => (tier === 0 ? 'Unlock' : `Upgrade ${tier}`);
  const s = plan.support;
  const n = (v: number): string => v.toLocaleString('en-US');

  return (
    <section className="card" data-testid="ability-section" aria-label="Ability order">
      <h2 className="section-title">Ability order</h2>
      <p className="section-note">Spend ability points in this order: unlock each ability, then upgrade it (Upgrade 1, 2, 3).</p>
      <ol className="seq" data-testid="ability-sequence">
        {plan.points.map((p) => {
          const a = byId.get(p.abilityId);
          return (
            <li key={p.point} className={`step ${p.kind}`} data-testid="ability-step" data-point={p.point} data-ability={p.abilityName} data-kind={p.kind} data-tier={p.tier}>
              <span className="step-icon">
                <Img className="ability-icon" src={abilityIcon(app.manifest, a)} alt="" size={34} fallback={p.abilityName} />
                <span className="step-n">{p.point}</span>
              </span>
              <span className="step-text">
                <span className="step-name">{p.abilityName}</span>
                <span className="step-kind">{tierLabel(p.tier)}</span>
                {p.beyondData && <span className="beyond">no data this far</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="ability-list" data-testid="ability-list">
        {plan.perAbility.map((pa) => {
          const a = byId.get(pa.abilityId);
          return (
            <div className="ability" key={pa.abilityId} data-testid="ability-card" data-ability={pa.name}>
              <Img className="ability-icon" src={abilityIcon(app.manifest, a)} alt="" size={44} fallback={pa.name} />
              <div style={{ minWidth: 0 }}>
                <h4>{pa.name}</h4>
                <p className="ab-sub">{a ? (SLOT_NAME[a.slot] ?? a.slot) : ''}</p>
                <p className="ab-plan">
                  Unlock at point <b>{pa.unlockPoint}</b> · upgrades at points <b>{pa.upgradePoints.join(', ')}</b>
                </p>
                {a && (
                  <details>
                    <summary>What the upgrades do</summary>
                    <ul className="tier-list">
                      <li>
                        <span className="tier-tag">U1</span>
                        <span>{a.upgrades[0]?.property_upgrades?.map((u) => upgradeLine(a, u)).join(', ') || '—'}</span>
                      </li>
                      <li>
                        <span className="tier-tag">U2</span>
                        <span>{a.description.t2_desc ? <Html html={a.description.t2_desc} manifest={app.manifest} /> : a.upgrades[1]?.property_upgrades?.map((u) => upgradeLine(a, u)).join(', ') || '—'}</span>
                      </li>
                      <li>
                        <span className="tier-tag">U3</span>
                        <span>{a.description.t3_desc ? <Html html={a.description.t3_desc} manifest={app.manifest} /> : a.upgrades[2]?.property_upgrades?.map((u) => upgradeLine(a, u)).join(', ') || '—'}</span>
                      </li>
                    </ul>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="support-note">
        Built from {n(s.totalMatches)} recorded ability orders. Games that followed this path: first 4 points {n(s.pathMatches[0] ?? 0)}, first 8 {n(s.pathMatches[1] ?? 0)}, first 12 {n(s.pathMatches[2] ?? 0)}, all {plan.points.length}{' '}
        {n(s.pathMatches[3] ?? 0)}.{plan.points.some((p) => p.beyondData) ? ' Points marked “no data this far” come after the recorded sequences end and follow the standard upgrade order.' : ''}
      </p>
    </section>
  );
}
