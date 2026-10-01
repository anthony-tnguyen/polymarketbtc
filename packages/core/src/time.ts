import type { EpochMillis } from '@pmbtc/contracts';

/**
 * Injectable clock. The feature/label/decision path NEVER calls `Date.now()`
 * directly (determinism invariant, MATH_SPEC §Determinism); it reads time from
 * a Clock. In live mode the Clock is a {@link SystemClock}; in replay it is a
 * {@link ManualClock} driven by the event stream's exchange_timestamp.
 */
export interface Clock {
  /** Current time in epoch milliseconds (UTC). */
  now(): EpochMillis;
}

/**
 * The ONE place allowed to read wall-clock time. Use only at process edges
 * (ingestion receive timestamps, operational logging) — never inside the
 * deterministic model path.
 */
export class SystemClock implements Clock {
  now(): EpochMillis {
    return Date.now();
  }
}

/**
 * A clock whose time is set explicitly. Used in replay (advanced by each event's
 * exchange_timestamp) and in tests. Time only ever moves forward; attempting to
 * move it backwards throws, which catches out-of-order event bugs early.
 */
export class ManualClock implements Clock {
  #now: EpochMillis;

  constructor(start: EpochMillis = 0) {
    this.#now = start;
  }

  now(): EpochMillis {
    return this.#now;
  }

  /** Set the clock to an absolute time. Must not move backwards. */
  set(t: EpochMillis): void {
    if (t < this.#now) {
      throw new Error(`ManualClock cannot move backwards: ${this.#now} -> ${t}`);
    }
    this.#now = t;
  }

  /** Advance the clock by a non-negative delta (milliseconds). */
  advance(deltaMs: number): void {
    if (deltaMs < 0) {
      throw new Error(`ManualClock cannot advance by a negative delta: ${deltaMs}`);
    }
    this.#now += deltaMs;
  }
}

/** Age (ms) of an event given the current time. Clamped at 0 (never negative). */
export function ageMs(nowMs: EpochMillis, eventMs: EpochMillis): number {
  const age = nowMs - eventMs;
  return age > 0 ? age : 0;
}

/**
 * True if an event is older than `maxAgeMs` relative to `nowMs`. Underpins the
 * feed-staleness invariants (I5/I6): a stale feed must not price an order.
 */
export function isStale(nowMs: EpochMillis, eventMs: EpochMillis, maxAgeMs: number): boolean {
  return ageMs(nowMs, eventMs) > maxAgeMs;
}

/** Milliseconds-per-unit helpers, to keep magic numbers out of callers. */
export const MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
} as const;
