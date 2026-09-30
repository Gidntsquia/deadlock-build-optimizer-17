import type { CSSProperties } from 'react';
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

/** lightning bolt: "unlock this ability" */
function Bolt() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.6 1 3.4 9.2h3.7L6.3 15l6.3-8.3H8.9L9.6 1z" fill="currentColor" />
    </svg>
  );
}

/** diamond with an up arrow: "upgrade this ability" */
function Upgrade() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.2 14.8 8 8 14.8 1.2 8 8 1.2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M5.5 9.2 8 6.6l2.5 2.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The 16 ability points as the in-game "Ability Point Order" chart: one row per ability, one column per point. */
export function AbilityOrder({ plan, kit }: { plan: AbilityPlan; kit: HeroKit }) {
  const { app } = useUi();
  const byId = new Map(kit.abilities.map((a) => [a.id, a]));
  const tierLabel = (tier: number): string => (tier === 0 ? 'Unlock' : `Upgrade ${tier}`);
  const s = plan.support;
  const n = (v: number): string => v.toLocaleString('en-US');

  // rows follow the in-game ability slots (1, 2, 3, ultimate); the chart columns follow the point order
  const rows = [...plan.perAbility].sort((x, y) => {
    const sx = byId.get(x.abilityId)?.slot ?? '';
    const sy = byId.get(y.abilityId)?.slot ?? '';
    return sx < sy ? -1 : sx > sy ? 1 : x.unlockPoint - y.unlockPoint;
  });
  const rowOf = new Map(rows.map((r, i) => [r.abilityId, i]));
  const cols = plan.points.length;
  const hasBeyond = plan.points.some((p) => p.beyondData);

  return (
    <section className="panel navy" data-testid="ability-section" aria-label="Ability order">
      <h2 className="navy-title">Ability point order</h2>
      <p className="navy-note">Read each row left to right: a bolt unlocks the ability, then upgrades 1, 2 and 3. Columns are the points in the order you spend them.</p>
      <ol className="seq" data-testid="ability-sequence" style={{ '--cols': cols, '--rows': rows.length } as CSSProperties}>
        {plan.points.map((p) => (
          <li key={`h${p.point}`} className="seq-head" aria-hidden="true" style={{ gridRow: 1, gridColumn: p.point + 1 }}>
            {p.point}
          </li>
        ))}
        {rows.map((r, i) => (
          <li key={`i${r.abilityId}`} className="seq-icon" aria-hidden="true" title={r.name} style={{ gridRow: i + 2, gridColumn: 1 }}>
            <span className="tile">
              <Img className="ability-icon" src={abilityIcon(app.manifest, byId.get(r.abilityId))} alt="" size={30} fallback={r.name} />
            </span>
          </li>
        ))}
        {plan.points.map((p) => (
          <li key={p.point} className={`step ${p.kind} ${p.beyondData ? 'is-beyond' : ''}`} data-testid="ability-step" data-point={p.point} data-ability={p.abilityName} data-kind={p.kind} data-tier={p.tier} style={{ gridRow: (rowOf.get(p.abilityId) ?? 0) + 2, gridColumn: p.point + 1 }}>
            <span className="pt" title={`Point ${p.point}: ${p.abilityName}, ${tierLabel(p.tier)}${p.beyondData ? ' (no data this far)' : ''}`}>
              {p.kind === 'unlock' ? <Bolt /> : <Upgrade />}
              {p.kind === 'upgrade' && (
                <span className="pt-n" aria-hidden="true">
                  {p.tier}
                </span>
              )}
            </span>
            <span className="visually-hidden">
              <span className="step-point">Point {p.point}: </span>
              <span className="step-name">{p.abilityName}</span>, <span className="step-kind">{tierLabel(p.tier)}</span>
              {p.beyondData && <span className="beyond"> (no data this far)</span>}
            </span>
          </li>
        ))}
      </ol>
      <ul className="seq-key" aria-hidden="true">
        <li>
          <span className="pt unlock">
            <Bolt />
          </span>
          Unlock
        </li>
        <li>
          <span className="pt upgrade">
            <Upgrade />
            <span className="pt-n">1</span>
          </span>
          <span className="pt upgrade">
            <Upgrade />
            <span className="pt-n">2</span>
          </span>
          <span className="pt upgrade">
            <Upgrade />
            <span className="pt-n">3</span>
          </span>
          Upgrades
        </li>
        {hasBeyond && (
          <li>
            <span className="pt upgrade is-beyond">
              <Upgrade />
            </span>
            No data this far
          </li>
        )}
      </ul>
      <div className="ability-list" data-testid="ability-list">
        {rows.map((pa) => {
          const a = byId.get(pa.abilityId);
          return (
            <div className="ability" key={pa.abilityId} data-testid="ability-card" data-ability={pa.name}>
              <span className="tile big">
                <Img className="ability-icon" src={abilityIcon(app.manifest, a)} alt="" size={44} fallback={pa.name} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h4>{pa.name}</h4>
                <p className="ab-sub">{a ? (SLOT_NAME[a.slot] ?? a.slot) : ''}</p>
                <p className="ab-plan">
                  <span>
                    Unlock at point <b>{pa.unlockPoint}</b>
                  </span>
                  <span>
                    Upgrades at points <b>{pa.upgradePoints.join(', ')}</b>
                  </span>
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
        Built from {n(s.totalMatches)} recorded ability orders. Games that followed this path: first 4 points {n(s.pathMatches[0] ?? 0)}, first 8 {n(s.pathMatches[1] ?? 0)}, first 12 {n(s.pathMatches[2] ?? 0)}, all {plan.points.length} {n(s.pathMatches[3] ?? 0)}.
        {hasBeyond ? ' Points with a dashed outline come after the recorded sequences end and follow the standard upgrade order.' : ''}
      </p>
    </section>
  );
}
