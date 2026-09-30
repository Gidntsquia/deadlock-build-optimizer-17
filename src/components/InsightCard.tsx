import { fmtSouls } from '../data/assets';
import type { BuildAnnotation, PersonalInsight } from '../personalization';
import type { Build } from '../types';

export function InsightCard({ insight, annotation, build, heroName }: { insight: PersonalInsight; annotation: BuildAnnotation; build: Build; heroName: string }) {
  const minute = Math.round(annotation.completeMin);
  const spare = annotation.spareSouls;
  const scope = insight.scope === 'hero' ? `${insight.games} of your ${heroName} games` : `your ${insight.games} standard games (too few ${heroName} games for a hero-specific number)`;
  return (
    <section className="card insight" data-testid="insight" aria-label="Your match history">
      <h2 className="section-title">Your pace</h2>
      <p>
        From {scope}: <strong>{Math.round(insight.medianDurationMin)} min</strong> median length, <strong>{fmtSouls(insight.soulsPerMin)}</strong> souls per minute,{' '}
        <strong>{fmtSouls(insight.medianNetWorth)}</strong> souls of net worth at the end, {(insight.winRate * 100).toFixed(0)}% wins.
      </p>
      <p>
        At that pace this build ({fmtSouls(build.totalCost)} souls) is complete around <strong>minute {minute}</strong>
        {annotation.minutesToSpare <= 0 ? (
          <>
            , about {Math.round(-annotation.minutesToSpare)} min before your typical game ends
            {spare >= 0 ? <>; it leaves roughly {fmtSouls(spare)} souls spare.</> : <>.</>}
          </>
        ) : (
          <>
            , {Math.round(annotation.minutesToSpare)} min after your typical game ends; the purchases marked below are ones your usual game does not reach.
          </>
        )}
      </p>
      <p className="fine">Time estimates on each purchase use this pace. They annotate the build; they never change which items are picked.</p>
    </section>
  );
}
