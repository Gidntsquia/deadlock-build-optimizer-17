import { useState } from 'react';
import { itemImage } from '../data/assets';
import type { Build } from '../types';
import type { ItemUsage, ValidationReport } from '../validation';
import { Img } from './Img';
import { useUi } from './context';

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  report: ValidationReport;
  builds: Build[];
  selectedId: string;
  heroName: string;
}

/** Validation report: how well each generated build matches the reference player's core item set. */
export function ValidationPanel({ report, builds, selectedId, heroName }: Props) {
  const { app, openItem } = useUi();
  const [showCore, setShowCore] = useState(false);
  const [showExp, setShowExp] = useState(false);
  const selected = builds.find((b) => b.id === selectedId) ?? builds[0];
  const inBuild = new Set(selected.items.map((i) => i.itemId));
  const pct = (v: number): string => `${Math.round(v * 100)}%`;

  const row = (u: ItemUsage, withFlag: boolean) => {
    const it = app.itemsById.get(u.itemId);
    return (
      <li key={u.itemId}>
        <button type="button" className="core-row" onClick={() => openItem(u.itemId)} data-testid={withFlag ? 'core-row' : 'experiment-row'} data-item-id={u.itemId}>
          <Img className="core-img" src={itemImage(app.manifest, it)} alt="" size={40} fallback={it?.name ?? '?'} />
          <span>
            <span className="core-name">{it?.name ?? `Item ${u.itemId}`}</span>
            <br />
            <span className="core-sub">
              {u.matches} of {report.matches} games · usually bought at {clock(u.medianBuyS)}
            </span>
          </span>
          {withFlag && <span className={`core-flag ${inBuild.has(u.itemId) ? '' : 'missing'}`}>{inBuild.has(u.itemId) ? 'In build' : 'Not in build'}</span>}
        </button>
      </li>
    );
  };

  return (
    <section className="panel slate" data-testid="validation-panel" aria-label="Validation report">
      <div className="panel-bar">
        <h2>Validation: how well the generator did</h2>
      </div>
      <div className="panel-body">
        <p className="lead">After the builds are generated from aggregate data alone, they are compared with what top player Zergggy actually bought on {heroName}. His games are a check on the result, not a source for it: the generator never reads them.</p>
        <p className="fine">
          Reference set: his {report.matches} most recent ranked/unranked {heroName} games ({report.wins} wins). An item is <b>core</b> when it appears in at least {Math.round(report.threshold * 100)}% of those games (wins count {report.winWeight}×). Items bought less often are experiments and are
          left out: {report.experimentCount} of them here, {report.coreItemIds.length} core items remain.
        </p>
        <div className="agree-rows" style={{ marginTop: 14 }}>
          {report.builds.map((a) => {
            const b = builds.find((x) => x.id === a.buildId);
            return (
              <div className="agree-row" key={a.buildId} data-testid="agreement-row" data-build={a.buildId}>
                <span className="agree-name">
                  {b?.name ?? a.buildId}
                  {a.buildId === selectedId ? ' (shown)' : ''}
                </span>
                <span className="agree-pct" data-testid="agreement-pct-row">
                  {a.agreementPct.toFixed(1)}%
                </span>
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${a.agreementPct}%` }} />
                </span>
                <span className="agree-detail">
                  item overlap {pct(a.overlap)} (precision {pct(a.precision)}, recall {pct(a.recall)}) · buy order {a.orderConcordance === null ? 'n/a' : pct(a.orderConcordance)}
                </span>
              </div>
            );
          })}
        </div>
        <p className="fine" style={{ marginTop: 12 }}>
          Agreement = {Math.round(report.overlapWeight * 100)}% item overlap + {Math.round(report.orderWeight * 100)}% buy-order match for the items both lists share. Nothing in this panel feeds back into the generator.
        </p>
        <button type="button" className="btn block" onClick={() => setShowCore((v) => !v)} aria-expanded={showCore} data-testid="toggle-core">
          {showCore ? 'Hide' : 'Show'} the {report.core.core.length} core items
        </button>
        {showCore && <ul className="core-rows">{report.core.core.map((u) => row(u, true))}</ul>}
        <button type="button" className="btn block" onClick={() => setShowExp((v) => !v)} aria-expanded={showExp} style={{ marginTop: 8 }} data-testid="toggle-experiments">
          {showExp ? 'Hide' : 'Show'} the {report.core.experiments.length} excluded experiments
        </button>
        {showExp && <ul className="core-rows">{report.core.experiments.map((u) => row(u, false))}</ul>}
        <p className="fine" style={{ marginTop: 12 }}>
          Reference games are real matchmaking games only (ranked or unranked; no private lobbies or bot games). His data was fetched separately and is read only by this validation step.
        </p>
      </div>
    </section>
  );
}
