import type { ItemBadge } from '../validation';

/** Sentence used as tooltip and screen-reader label for a badge. */
export function badgeSentence(b: ItemBadge, sample: number): string {
  if (b.status === 'core') return `Core item: Zergggy bought it in ${b.matches} of ${sample} sampled matches.`;
  if (b.status === 'experiment') return `Not core: Zergggy bought it in only ${b.matches} of ${sample} sampled matches (an experiment).`;
  return `Not core: Zergggy did not buy it in any of ${sample} sampled matches.`;
}

/** Core / not-core marker from the validation step. */
export function CoreBadge({ badge, sample }: { badge: ItemBadge; sample: number }) {
  const core = badge.status === 'core';
  return (
    <span className={`pill ${core ? 'core' : 'notcore'}`} title={badgeSentence(badge, sample)} aria-label={badgeSentence(badge, sample)} data-testid="core-badge" data-status={badge.status}>
      {core ? 'Core' : 'Not core'} · {badge.matches}/{sample}
    </span>
  );
}
