import { useCallback, useEffect, useMemo, useState } from 'react';
import { AbilityOrder } from './components/AbilityOrder';
import { BuildSummary } from './components/BuildSummary';
import { BuyList } from './components/BuyList';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/Footer';
import { HeroPicker, heroPortrait } from './components/HeroPicker';
import { Img } from './components/Img';
import { ItemSheet } from './components/ItemSheet';
import { ValidationPanel } from './components/ValidationPanel';
import { UiContext } from './components/context';
import { DEFAULT_HERO_ID, loadAppData, loadHeroResult, type AppData, type HeroResult } from './data/app-data';
import { fmtSouls } from './data/assets';
import { hashBuild } from './generator';
import { badgesFor } from './validation';

function heroFromHash(): number | null {
  const m = /hero=(\d+)/.exec(window.location.hash);
  return m ? Number(m[1]) : null;
}

export default function App() {
  const [app, setApp] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [heroId, setHeroId] = useState<number>(() => heroFromHash() ?? DEFAULT_HERO_ID);
  const [result, setResult] = useState<HeroResult | null>(null);
  const [heroError, setHeroError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openItemId, setOpenItemId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAppData()
      .then((d) => {
        if (cancelled) return;
        setApp(d);
        // an unknown hero id in the address falls back to the default hero
        setHeroId((id) => (d.shared.heroes.some((h) => h.id === id) ? id : DEFAULT_HERO_ID));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    setHeroError(null);
    loadHeroResult(app, heroId)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setResult(null);
          setHeroError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [app, heroId]);

  useEffect(() => {
    try {
      window.history.replaceState(null, '', `#hero=${heroId}`);
    } catch {
      /* address bar not writable: ignore */
    }
  }, [heroId]);

  const selectHero = useCallback((id: number) => {
    setHeroId(id);
    setOpenItemId(null);
    setPickerOpen(false);
  }, []);
  const closeItem = useCallback(() => setOpenItemId(null), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const openItem = useCallback((id: number) => setOpenItemId(id), []);

  const ui = useMemo(() => (app ? { app, openItem } : null), [app, openItem]);
  const hero = app?.shared.heroes.find((h) => h.id === heroId);
  const fresh = result && result.build.heroId === heroId ? result : null;
  const build = fresh ? fresh.build : null;
  const buildHash = useMemo(() => (build ? hashBuild(build) : null), [build]);

  const agreement = fresh?.report?.agreement ?? null;
  const sample = fresh?.report?.matches ?? 0;

  if (loadError) {
    return (
      <main className="app">
        <div className="window-body">
          <div className="state error" role="alert" data-testid="load-error">
            <strong>The data snapshots could not be loaded.</strong>
            {loadError}
            <br />
            Run <code>npm run fetch-data</code> once (it needs a network connection), then reload.
          </div>
        </div>
      </main>
    );
  }

  if (!app || !ui) {
    return (
      <main className="app">
        <div className="window-body">
          <div className="state" role="status" data-testid="loading">
            <div className="spinner" />
            Loading the data snapshot…
          </div>
        </div>
      </main>
    );
  }

  const selectedItem = openItemId !== null ? openItemId : null;
  const openBuildItem = selectedItem !== null && build ? (build.items.find((i) => i.itemId === selectedItem) ?? null) : null;

  return (
    <UiContext.Provider value={ui}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-eyebrow">Deadlock</span>
            <span className="brand-title">Build Optimizer</span>
          </div>
          <button type="button" className="hero-btn" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-label={`Hero: ${hero?.name ?? ''}. Change hero`} data-testid="hero-button">
            <Img className="portrait" src={heroPortrait(app.manifest, hero)} alt="" size={38} fallback={hero?.name ?? '?'} />
            <span className="hero-name" data-testid="hero-name">
              {hero?.name ?? 'Hero'}
            </span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      <main className="app">
        <ErrorBoundary key={heroId}>
          {fresh && build && (
            <div className="window-head">
              <section className="hero-head" data-testid="hero-head">
                <Img className="portrait" src={heroPortrait(app.manifest, hero)} alt="" size={64} fallback={build.heroName} />
                <div style={{ minWidth: 0 }}>
                  <h1>{build.heroName}</h1>
                  <p>
                    {build.heroMatches.toLocaleString('en-US')} matches in the data · {(build.heroWinRate * 100).toFixed(1)}% win rate · budget {fmtSouls(build.budget)} souls
                  </p>
                </div>
              </section>
            </div>
          )}
          <div className="window-body">
            {heroError && (
              <div className="state error" role="alert" data-testid="hero-error">
                <strong>Could not build {hero?.name ?? 'this hero'}.</strong>
                {heroError}
              </div>
            )}
            {!fresh && !heroError && (
              <div className="state" role="status" data-testid="generating">
                <div className="spinner" />
                Generating the build for {hero?.name}…
              </div>
            )}
            {fresh && build && (
              <>
                <div className="build-panel" data-testid="build-panel">
                  <BuildSummary build={build} agreement={agreement} sample={sample} />
                  <section className="buy-order" aria-label="Buy order">
                    <h2 className="section-heading">Buy order</h2>
                    <p className="section-note">Tap an item for its details. {fresh.report ? 'Badges show whether Zergggy treats the item as core (bought in at least 30% of his sampled games).' : `No validation data for ${build.heroName}: the reference player's data covers Infernus only.`}</p>
                    <BuyList build={build} agreement={agreement} sample={sample} />
                  </section>
                  <AbilityOrder plan={build.abilityPlan} kit={fresh.kit} />
                </div>

                {fresh.report ? (
                  <ValidationPanel report={fresh.report} build={build} heroName={build.heroName} />
                ) : (
                  <section className="panel slate" data-testid="validation-panel" aria-label="Validation report">
                    <div className="panel-bar">
                      <h2>Validation</h2>
                    </div>
                    <div className="panel-body">
                      <p className="fine">Validation against the reference player covers Infernus only. Pick Infernus to see core / not-core badges and agreement percentages.</p>
                    </div>
                  </section>
                )}
              </>
            )}
            <Footer meta={app.shared.meta} buildHash={buildHash} />
          </div>
        </ErrorBoundary>
      </main>

      {pickerOpen && <HeroPicker heroes={app.shared.heroes} selectedId={heroId} onSelect={selectHero} onClose={closePicker} />}
      {selectedItem !== null && (
        <ItemSheet
          itemId={selectedItem}
          buildItem={openBuildItem}
          badge={fresh?.report ? (agreement?.badges[selectedItem] ?? badgesFor([selectedItem], fresh.report.core)[selectedItem] ?? null) : null}
          sample={sample}
          heroName={build?.heroName ?? ''}
          onClose={closeItem}
        />
      )}
    </UiContext.Provider>
  );
}
