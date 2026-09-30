/**
 * Personal insight from the player's own match history (standard mode only).
 *
 * It annotates a generated build; it never changes which items the generator picks:
 *   - typical game length, souls per minute and final net worth come from the player's own matches
 *     (this hero's matches when there are enough of them, otherwise all standard matches),
 *   - every purchase gets a rough "time you reach it" estimate (running soul total / souls per minute),
 *   - the point in the buy list where the player's typical game has already ended is marked, and the late-game
 *     budget is compared with the net worth the player usually finishes with.
 */
import type { Build, PlayerHistorySnapshot, PlayerMatchRow } from '../types';

/** matches shorter than this are treated as abandoned or stomped and ignored */
const MIN_DURATION_S = 600;
/** hero-specific numbers need at least this many matches, otherwise all standard matches are used */
export const MIN_HERO_GAMES = 8;

export interface PersonalInsight {
  scope: 'hero' | 'all';
  heroId: number;
  games: number;
  wins: number;
  winRate: number;
  medianDurationMin: number;
  /** median net worth at the end of the match */
  medianNetWorth: number;
  /** median of net worth / match minutes */
  soulsPerMin: number;
  accountId: number;
  fetchedAt: string;
}

export interface BuildAnnotation {
  /** estimated minute each purchase is reached, same order as build.items */
  etaMin: number[];
  /** index of the first purchase that costs more than the player's typical final net worth, or null */
  beyondTypicalIndex: number | null;
  /** typical final net worth minus the build total (negative: the build is bigger than the player usually gets) */
  spareSouls: number;
  /** estimated minute the whole build is complete */
  completeMin: number;
  /** completeMin minus the typical match length (negative: finished before the typical game ends) */
  minutesToSpare: number;
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const isWin = (r: PlayerMatchRow): boolean => r.match_result === r.player_team;

export function computeInsight(history: PlayerHistorySnapshot, heroId: number): PersonalInsight | null {
  const usable = history.rows.filter((r) => r.match_duration_s >= MIN_DURATION_S && (r.net_worth ?? 0) > 0);
  if (usable.length === 0) return null;
  const mine = usable.filter((r) => r.hero_id === heroId);
  const scope = mine.length >= MIN_HERO_GAMES ? 'hero' : 'all';
  const sample = scope === 'hero' ? mine : usable;
  const wins = sample.filter(isWin).length;
  return {
    scope,
    heroId,
    games: sample.length,
    wins,
    winRate: wins / sample.length,
    medianDurationMin: median(sample.map((r) => r.match_duration_s / 60)),
    medianNetWorth: median(sample.map((r) => r.net_worth ?? 0)),
    soulsPerMin: median(sample.map((r) => (r.net_worth ?? 0) / (r.match_duration_s / 60))),
    accountId: history.account_id,
    fetchedAt: history.fetchedAt,
  };
}

export function annotateBuild(build: Build, insight: PersonalInsight): BuildAnnotation {
  const etaMin = build.items.map((i) => i.running / insight.soulsPerMin);
  const beyond = build.items.findIndex((i) => i.running > insight.medianNetWorth);
  const completeMin = build.totalCost / insight.soulsPerMin;
  return {
    etaMin,
    beyondTypicalIndex: beyond >= 0 ? beyond : null,
    spareSouls: Math.round(insight.medianNetWorth - build.totalCost),
    completeMin,
    minutesToSpare: completeMin - insight.medianDurationMin,
  };
}
