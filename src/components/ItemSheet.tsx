import { componentsOf, fmtSouls, itemImage, itemSections, SLOT_LABEL, upgradesOf, type ItemSection, type StatLine } from '../data/assets';
import type { BuildItem, CatalogItem } from '../types';
import type { ItemBadge } from '../validation';
import { CoreBadge } from './Badge';
import { Html } from './Html';
import { Img } from './Img';
import { Sheet } from './Sheet';
import { useUi } from './context';

const SECTION_TITLE: Record<ItemSection['type'], string> = { innate: 'Stats', passive: 'Passive', active: 'Active' };

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Lines({ lines, keyLines }: { lines: StatLine[]; keyLines: StatLine[] }) {
  if (lines.length + keyLines.length === 0) return null;
  const row = (l: StatLine, key: boolean) => (
    <li className={`statline ${key ? 'key' : ''}`} key={`${key ? 'k' : 's'}-${l.key}`} data-testid="stat-line" data-prop={l.key}>
      <span className="sl-label">{l.label}</span>
      <span className={`sl-value v-${l.cssClass}`}>{l.value}</span>
    </li>
  );
  return (
    <ul className="statlines">
      {keyLines.map((l) => row(l, true))}
      {lines.map((l) => row(l, false))}
    </ul>
  );
}

interface Props {
  itemId: number;
  buildItem: BuildItem | null;
  badge: ItemBadge | null;
  sample: number;
  heroName: string;
  onClose: () => void;
}

/** Detail card for one item, rendered from the assets data (image, cost, tier, slot, stat lines, passive and active text). */
export function ItemSheet({ itemId, buildItem, badge, sample, heroName, onClose }: Props) {
  const { app, openItem } = useUi();
  const item: CatalogItem | undefined = app.itemsById.get(itemId);
  if (!item) {
    return (
      <Sheet title="Item not found" onClose={onClose} testId="item-sheet">
        <p className="empty">Item {itemId} is not in the catalog snapshot.</p>
      </Sheet>
    );
  }
  const sections = itemSections(item);
  const hasText = sections.some((s) => s.texts.length > 0);
  const fallbackTexts = hasText ? [] : [item.description.desc, item.description.passive, item.description.active].filter((t): t is string => !!t);
  const hasActive = item.is_active_item || sections.some((s) => s.type === 'active');
  const hasPassive = sections.some((s) => s.type === 'passive');
  const parts = componentsOf(item, app.itemsByClass);
  const upgrades = upgradesOf(item, app.shared.catalog);

  const link = (it: CatalogItem) => (
    <button type="button" key={it.id} className="link-chip" onClick={() => openItem(it.id)} data-testid="item-link" data-item-id={it.id}>
      <Img src={itemImage(app.manifest, it)} alt="" size={34} fallback={it.name} />
      <span>{it.name}</span>
    </button>
  );

  return (
    <Sheet key={itemId} title={item.name} onClose={onClose} testId="item-sheet">
      <div className={`detail-top slot-${item.item_slot_type}`}>
        <Img className="detail-img" src={itemImage(app.manifest, item)} alt={`${item.name} shop image`} size={96} fallback={item.name} />
        <div>
          <div className="chips">
            <span className="chip" data-testid="item-tier">
              Tier {item.item_tier}
            </span>
            <span className="chip slot" data-testid="item-slot">
              {SLOT_LABEL[item.item_slot_type]}
            </span>
            {hasPassive && <span className="chip">Passive</span>}
            {hasActive && <span className="chip">Active</span>}
          </div>
          <p className="detail-cost">
            <span className="chip cost" data-testid="item-detail-cost">
              {fmtSouls(item.cost)} souls
            </span>
          </p>
        </div>
      </div>

      {sections.map((s, i) => (
        <section className="block" key={`${s.type}-${i}`} data-testid={`section-${s.type}`}>
          <h3>{SECTION_TITLE[s.type]}</h3>
          {s.texts.map((t, j) => (
            <Html key={j} html={t} manifest={app.manifest} />
          ))}
          <Lines lines={s.stats} keyLines={s.keyStats} />
        </section>
      ))}
      {fallbackTexts.length > 0 && (
        <section className="block" data-testid="section-description">
          <h3>Description</h3>
          {fallbackTexts.map((t, j) => (
            <Html key={j} html={t} manifest={app.manifest} />
          ))}
        </section>
      )}
      {sections.length === 0 && fallbackTexts.length === 0 && <p className="fine block">The assets data lists no stats or effect text for this item.</p>}

      {(parts.length > 0 || upgrades.length > 0) && (
        <section className="block">
          {parts.length > 0 && (
            <>
              <h3>Built from</h3>
              <div className="link-chips">{parts.map(link)}</div>
            </>
          )}
          {upgrades.length > 0 && (
            <div style={{ marginTop: parts.length ? 12 : 0 }}>
              <h3>Upgrades into</h3>
              <div className="link-chips">{upgrades.map(link)}</div>
            </div>
          )}
        </section>
      )}

      {buildItem && (
        <section className="block" data-testid="section-build">
          <h3>In this build</h3>
          <ul className="statlines">
            <li className="statline">
              <span className="sl-label">Buy phase</span>
              <span className="sl-value" style={{ textTransform: 'capitalize' }}>
                {buildItem.phase} game
              </span>
            </li>
            <li className="statline">
              <span className="sl-label">Price</span>
              <span className="sl-value">{fmtSouls(buildItem.cost)}</span>
            </li>
            {buildItem.netCost !== buildItem.cost && (
              <li className="statline">
                <span className="sl-label">You pay (owned component counts)</span>
                <span className="sl-value">{fmtSouls(buildItem.netCost)}</span>
              </li>
            )}
            <li className="statline">
              <span className="sl-label">Running soul total</span>
              <span className="sl-value">{fmtSouls(buildItem.running)}</span>
            </li>
            <li className="statline">
              <span className="sl-label">{heroName} win rate when bought</span>
              <span className="sl-value">{(buildItem.evidence.winRate * 100).toFixed(1)}%</span>
            </li>
            <li className="statline">
              <span className="sl-label">Bought in</span>
              <span className="sl-value">{(buildItem.evidence.pickRate * 100).toFixed(0)}% of {heroName} games</span>
            </li>
            {buildItem.evidence.avgBuyTimeS !== null && (
              <li className="statline">
                <span className="sl-label">Average buy time</span>
                <span className="sl-value">{clock(buildItem.evidence.avgBuyTimeS)}</span>
              </li>
            )}
          </ul>
          <h3 style={{ marginTop: 12 }}>Why it is here</h3>
          <ul className="reasons">
            {buildItem.reasons
              .filter((r) => !r.startsWith('Stats:'))
              .map((r, i) => (
                <li key={i}>{r}</li>
              ))}
          </ul>
        </section>
      )}

      {badge && (
        <div className="badge-box" data-testid="badge-box">
          <CoreBadge badge={badge} sample={sample} />
          {badge.status === 'unseen'
            ? `Zergggy did not buy this in any of the ${sample} sampled games.`
            : `Zergggy bought this in ${badge.matches} of ${sample} sampled games (${(badge.rawFreq * 100).toFixed(0)}%; win-weighted ${(badge.weightedFreq * 100).toFixed(0)}%). Core needs at least 30%.`}
        </div>
      )}
    </Sheet>
  );
}
