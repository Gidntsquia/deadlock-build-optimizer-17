import { DEFAULT_PARAMS, GENERATOR_VERSION } from '../generator';
import type { MetaSnapshot } from '../types';

function day(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

export function Footer({ meta, buildSetHash }: { meta: MetaSnapshot; buildSetHash: string | null }) {
  const w = meta.analytics.window;
  const fetched = meta.fetchedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const pw = DEFAULT_PARAMS.phaseWeights;
  return (
    <footer className="footer card" data-testid="footer">
      <p>
        Aggregate data from the Deadlock API: {meta.analytics.matchMode.replace(/,/g, ', ')} {meta.analytics.gameMode} matches, average badge {meta.analytics.minAverageBadge} or higher, since the {day(w.minUnixTimestamp)} patch ({w.days.toFixed(1)} days). Snapshot fetched {fetched}.
        The app reads only that snapshot, so it works offline.
      </p>
      <p>
        Generator {GENERATOR_VERSION}
        {buildSetHash ? `, build-set hash ${buildSetHash}` : ''}. The same snapshot always gives the same builds.
      </p>
      <details>
        <summary>How builds are scored</summary>
        <ul className="bullets">
          <li>Win rate: shrunk win-rate lift against items bought at the same time.</li>
          <li>Usage: how often players of the hero buy the item.</li>
          <li>Stat value per soul: power gain per 1000 souls from the item’s stats and effects.</li>
          <li>Soul thresholds: spending that crosses a slot bonus threshold.</li>
          <li>Passives and actives: effects valued by uptime and cooldown.</li>
          <li>Kit fit: Spirit and fire-rate scaling of the hero’s own abilities.</li>
          <li>Synergy with items already in the build, and game phase (buy-time window).</li>
        </ul>
        <table>
          <thead>
            <tr>
              <th>Phase</th>
              <th>win</th>
              <th>pick</th>
              <th>power</th>
              <th>kit</th>
              <th>pair</th>
              <th>timing</th>
            </tr>
          </thead>
          <tbody>
            {(['early', 'mid', 'late'] as const).map((p) => (
              <tr key={p}>
                <td>{p}</td>
                <td>{pw[p].win}</td>
                <td>{pw[p].pick}</td>
                <td>{pw[p].power}</td>
                <td>{pw[p].kit}</td>
                <td>{pw[p].pair}</td>
                <td>{pw[p].timing}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>The README lists every input and weight.</p>
      </details>
    </footer>
  );
}
