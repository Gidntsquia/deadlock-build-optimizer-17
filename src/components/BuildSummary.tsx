import { fmtSouls, SLOT_LABEL } from '../data/assets';
import type { Build, SlotType } from '../types';
import type { BuildAgreement } from '../validation';

const SLOTS: SlotType[] = ['weapon', 'vitality', 'spirit'];

export function BuildSummary({ build, agreement, sample }: { build: Build; agreement: BuildAgreement | null; sample: number }) {
  const total = SLOTS.reduce((s, k) => s + build.slotSpend[k], 0) || 1;
  return (
    <section className="panel" data-testid="build-summary" aria-label="Build summary">
      <div className="panel-bar">
        <h2>Recommended build</h2>
      </div>
      <div className="panel-body">
        <p className="tagline">Picked from what {build.heroName} players buy and win with, then scored by what each item adds per soul spent.</p>
        <div className="stats">
          <div className="stat">
            <div className="stat-v" data-testid="build-total">
              {fmtSouls(build.totalCost)}
            </div>
            <div className="stat-l">souls in total</div>
          </div>
          <div className="stat">
            <div className="stat-v">{build.finalItemIds.length}</div>
            <div className="stat-l">final items</div>
          </div>
          <div className="stat">
            <div className="stat-v">{build.items.length}</div>
            <div className="stat-l">purchases</div>
          </div>
        </div>
        <div className="spend-bar" role="img" aria-label={SLOTS.map((k) => `${SLOT_LABEL[k]} ${fmtSouls(build.slotSpend[k])} souls`).join(', ')}>
          {SLOTS.map((k) => (
            <span key={k} className={`bg-${k}`} style={{ width: `${(build.slotSpend[k] / total) * 100}%` }} />
          ))}
        </div>
        <div className="legend">
          {SLOTS.map((k) => (
            <span key={k}>
              <span className={`dot bg-${k}`} />
              {SLOT_LABEL[k]} {fmtSouls(build.slotSpend[k])}
            </span>
          ))}
        </div>
        <p className="fine" style={{ marginTop: 8 }}>
          Sized to fit a budget of {fmtSouls(build.budget)} souls (90% of the average final net worth of this hero in the data).
        </p>
        {agreement && (
          <div className="agree-chip" data-testid="agreement-chip">
            <span className="agree-v" data-testid="agreement-pct">
              {agreement.agreementPct.toFixed(1)}%
            </span>
            <span className="agree-t">
              agreement with Zergggy’s core Infernus items
              <br />
              (checked against {sample} of their recent games; see Validation below)
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
