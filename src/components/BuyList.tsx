import { Fragment, type CSSProperties } from 'react';
import { itemImage, fmtSouls, SLOT_LABEL } from '../data/assets';
import type { PersonalInsight, BuildAnnotation } from '../personalization';
import type { Build, BuildItem, PhaseId } from '../types';
import type { BuildAgreement } from '../validation';
import { CoreBadge, badgeSentence } from './Badge';
import { Img } from './Img';
import { useUi } from './context';

const PHASES: { id: PhaseId; label: string }[] = [
  { id: 'early', label: 'Early game' },
  { id: 'mid', label: 'Mid game' },
  { id: 'late', label: 'Late game' },
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

interface BuyListProps {
  build: Build;
  agreement: BuildAgreement | null;
  sample: number;
  insight: PersonalInsight | null;
  annotation: BuildAnnotation | null;
}

/** The ordered purchase list as in-game item cards, grouped early / mid / late, with cost and running soul total per item. */
export function BuyList({ build, agreement, sample, insight, annotation }: BuyListProps) {
  const { app, openItem } = useUi();
  const indexOf = new Map(build.items.map((it, i) => [it, i]));
  const nameOf = (id: number | null): string => (id === null ? '' : (app.itemsById.get(id)?.name ?? `Item ${id}`));
  const hasStones = build.items.some((it) => it.role === 'component');

  return (
    <div className="buy-list" data-testid="buy-list">
      <ul className="card-key" aria-label="How to read the cards">
        {agreement && (
          <>
            <li>
              <span className="ck light" aria-hidden="true" />
              Core item
            </li>
            <li>
              <span className="ck dark" aria-hidden="true" />
              Not core
            </li>
          </>
        )}
        {hasStones && (
          <li>
            <span className="ck stone" aria-hidden="true" />
            Stepping stone, upgraded later
          </li>
        )}
        <li>
          <span className="ck step" aria-hidden="true">
            1
          </span>
          Buy order
        </li>
      </ul>
      {PHASES.map(({ id, label }) => {
        const items = build.items.filter((it) => it.phase === id);
        if (items.length === 0) return null;
        const spent = items.reduce((s, it) => s + it.netCost, 0);
        return (
          <section className="panel phase" key={id} data-testid={`phase-${id}`} aria-label={label}>
            <div className="panel-bar phase-head">
              <h3>{label}</h3>
              <span className="phase-sum">
                {items.length} {items.length === 1 ? 'purchase' : 'purchases'} · {fmtSouls(spent)} souls
              </span>
            </div>
            <ul className="rows">
              {items.map((it) => {
                const index = indexOf.get(it)!;
                const showEnd = annotation && insight && annotation.beyondTypicalIndex === index;
                return (
                  <Fragment key={`${it.itemId}-${index}`}>
                    {showEnd && (
                      <li className="end-li">
                        <div className="end-marker" data-testid="typical-end-marker">
                          Your typical game ({Math.round(insight.medianDurationMin)} min, about {fmtSouls(insight.medianNetWorth)} souls) is over before this purchase.
                        </div>
                      </li>
                    )}
                    <li className="cell" style={{ '--i': index } as CSSProperties}>
                      <ItemRow item={it} index={index} badge={agreement?.badges[it.itemId]} sample={sample} etaMin={annotation?.etaMin[index]} soulsPerMin={insight?.soulsPerMin} nameOf={nameOf} onOpen={() => openItem(it.itemId)} />
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

interface ItemRowProps {
  item: BuildItem;
  index: number;
  badge: BuildAgreement['badges'][number] | undefined;
  sample: number;
  etaMin: number | undefined;
  soulsPerMin: number | undefined;
  nameOf: (id: number | null) => string;
  onOpen: () => void;
}

/** One item card: art with tier tag, name band, and a small ledger (cost, running total, core badge). */
function ItemRow({ item, index, badge, sample, etaMin, soulsPerMin, nameOf, onOpen }: ItemRowProps) {
  const { app } = useUi();
  const cat = app.itemsById.get(item.itemId);
  const isComponent = item.role === 'component';
  const relation = isComponent ? `Component of ${nameOf(item.upgradedInto)}` : item.consumes.length === 1 ? `Upgrade of ${nameOf(item.consumes[0])}` : item.consumes.length > 1 ? `Upgrade of ${item.consumes.length} items` : null;
  // light label = core for the reference player (or nothing to compare against); dark label = not core
  const tone = badge && badge.status !== 'core' ? 'dark' : 'light';
  const eta = etaMin !== undefined ? Math.max(1, Math.round(etaMin)) : null;
  const label = [`${item.name}, tier ${item.tier} ${SLOT_LABEL[item.slot]} item`, `${fmtSouls(item.cost)} souls`, `running total ${fmtSouls(item.running)}`, relation, badge ? badgeSentence(badge, sample) : null, eta !== null ? `reached around minute ${eta} at your pace` : null]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className={`item-row slot-${item.slot} tone-${tone} ${isComponent ? 'is-component' : ''} ${cat?.is_active_item ? 'is-active' : ''}`}
      onClick={onOpen}
      data-testid="item-row"
      data-item-id={item.itemId}
      data-item-name={item.name}
      data-role={item.role}
      data-cost={item.cost}
      data-running={item.running}
      aria-label={`${label}. Open details.`}
    >
      <span className="art">
        <Img className="item-img" src={itemImage(app.manifest, cat)} alt="" size={112} fluid fallback={item.name} />
        <span className="art-tl">
          <span className="step-chip" aria-hidden="true">
            {index + 1}
          </span>
          {eta !== null && (
            <span className="eta-chip" title={`At about ${fmtSouls(soulsPerMin ?? 0)} souls per minute you reach this total around minute ${eta}.`} data-testid="eta">
              ~{eta}m
            </span>
          )}
        </span>
        <span className="tier-flag" aria-hidden="true">
          <span>{ROMAN[item.tier] ?? item.tier}</span>
        </span>
        {cat?.is_active_item && (
          <span className="active-chip" aria-hidden="true">
            Active
          </span>
        )}
      </span>
      <span className={`name-band ${item.name.length > 15 ? 'long' : ''}`}>
        <span className="item-name">{item.name}</span>
      </span>
      <span className="ledger">
        <span className="money">
          <span className="item-cost" data-testid="item-cost">
            {fmtSouls(item.cost)}
          </span>
          {item.netCost !== item.cost && (
            <span className="item-net" title="Price after the owned component counts toward the upgrade">
              pay {fmtSouls(item.netCost)}
            </span>
          )}
        </span>
        <span className="item-total" data-testid="item-running">
          total {fmtSouls(item.running)}
        </span>
        {badge && <CoreBadge badge={badge} sample={sample} />}
        {isComponent && item.upgradedInto !== null && (
          <span className="item-rel" title={relation ?? undefined}>
            → {nameOf(item.upgradedInto)}
          </span>
        )}
      </span>
    </button>
  );
}
