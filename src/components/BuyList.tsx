import { itemImage, fmtSouls, SLOT_LABEL } from '../data/assets';
import type { PersonalInsight, BuildAnnotation } from '../personalization';
import type { Build, BuildItem, PhaseId } from '../types';
import type { BuildAgreement } from '../validation';
import { CoreBadge } from './Badge';
import { Img } from './Img';
import { useUi } from './context';

const PHASES: { id: PhaseId; label: string }[] = [
  { id: 'early', label: 'Early game' },
  { id: 'mid', label: 'Mid game' },
  { id: 'late', label: 'Late game' },
];

interface BuyListProps {
  build: Build;
  agreement: BuildAgreement | null;
  sample: number;
  insight: PersonalInsight | null;
  annotation: BuildAnnotation | null;
}

/** The ordered purchase list, grouped early / mid / late, with cost and running soul total per item. */
export function BuyList({ build, agreement, sample, insight, annotation }: BuyListProps) {
  const { app, openItem } = useUi();
  const indexOf = new Map(build.items.map((it, i) => [it, i]));
  const nameOf = (id: number | null): string => (id === null ? '' : app.itemsById.get(id)?.name ?? `Item ${id}`);

  return (
    <div data-testid="buy-list">
      {PHASES.map(({ id, label }) => {
        const items = build.items.filter((it) => it.phase === id);
        if (items.length === 0) return null;
        const spent = items.reduce((s, it) => s + it.netCost, 0);
        return (
          <section className="phase" key={id} data-testid={`phase-${id}`} aria-label={label}>
            <div className="phase-head">
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
                  <li key={`${it.itemId}-${index}`}>
                    {showEnd && (
                      <div className="end-marker" data-testid="typical-end-marker">
                        Your typical game ({Math.round(insight.medianDurationMin)} min, about {fmtSouls(insight.medianNetWorth)} souls) is over before this purchase.
                      </div>
                    )}
                    <ItemRow
                      item={it}
                      badge={agreement?.badges[it.itemId]}
                      sample={sample}
                      etaMin={annotation?.etaMin[index]}
                      soulsPerMin={insight?.soulsPerMin}
                      nameOf={nameOf}
                      onOpen={() => openItem(it.itemId)}
                    />
                  </li>
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
  badge: BuildAgreement['badges'][number] | undefined;
  sample: number;
  etaMin: number | undefined;
  soulsPerMin: number | undefined;
  nameOf: (id: number | null) => string;
  onOpen: () => void;
}

function ItemRow({ item, badge, sample, etaMin, soulsPerMin, nameOf, onOpen }: ItemRowProps) {
  const { app } = useUi();
  const cat = app.itemsById.get(item.itemId);
  const relation =
    item.role === 'component'
      ? `Component → ${nameOf(item.upgradedInto)}`
      : item.consumes.length === 1
        ? `Upgrade of ${nameOf(item.consumes[0])}`
        : item.consumes.length > 1
          ? `Upgrade of ${item.consumes.length} items`
          : null;
  return (
    <button
      type="button"
      className={`item-row slot-${item.slot} ${item.role === 'component' ? 'is-component' : ''}`}
      onClick={onOpen}
      data-testid="item-row"
      data-item-id={item.itemId}
      data-item-name={item.name}
      data-role={item.role}
      data-cost={item.cost}
      data-running={item.running}
      aria-label={`${item.name}, tier ${item.tier} ${SLOT_LABEL[item.slot]} item, ${fmtSouls(item.cost)} souls, running total ${fmtSouls(item.running)}. Open details.`}
    >
      <Img className="item-img" src={itemImage(app.manifest, cat)} alt="" size={52} fallback={item.name} />
      <span className="item-main">
        <span className="item-name">{item.name}</span>
        <span className="item-meta">
          T{item.tier} · <span className="slot-label">{SLOT_LABEL[item.slot]}</span>
        </span>
      </span>
      <span className="item-side">
        <span className="item-cost" data-testid="item-cost">
          {fmtSouls(item.cost)}
        </span>
        {item.netCost !== item.cost && (
          <span className="item-net" title="Price after the owned component counts toward the upgrade">
            pay {fmtSouls(item.netCost)}
          </span>
        )}
        <span className="item-total" data-testid="item-running">
          total {fmtSouls(item.running)}
        </span>
      </span>
      {(relation || badge || etaMin !== undefined) && (
        <span className="pills">
          {relation && <span className="pill up">{relation}</span>}
          {badge && <CoreBadge badge={badge} sample={sample} />}
          {etaMin !== undefined && (
            <span className="pill eta" title={`At about ${fmtSouls(soulsPerMin ?? 0)} souls per minute you reach this total around minute ${Math.round(etaMin)}.`} data-testid="eta">
              ~{Math.max(1, Math.round(etaMin))} min
            </span>
          )}
        </span>
      )}
    </button>
  );
}
