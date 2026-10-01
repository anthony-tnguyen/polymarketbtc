import type { EpochMillis } from '@pmbtc/contracts';

/**
 * Clock synchronization. We estimate how far our local clock is from a reference
 * (venue server time) so the risk engine can enforce MAX_CLOCK_DRIFT (I5/I6/I14):
 * trading on a mis-set local clock mis-ages every feed.
 *
 * Pure/deterministic: all times are supplied by the caller (the sampling I/O
 * lives in the socket adapter); nothing here reads the wall clock.
 */

/** One round-trip timing sample (NTP-style). All epoch millis. */
export interface ClockSample {
  /** Local time the request was sent. */
  t0: EpochMillis;
  /** Server time reported in the response. */
  tServer: EpochMillis;
  /** Local time the response was received. */
  t1: EpochMillis;
}

export interface ClockOffsetEstimate {
  /** Estimated (localClock - serverClock) in ms. Positive = local is ahead. */
  offsetMs: number;
  /** Round-trip delay in ms. */
  roundTripMs: number;
}

/**
 * NTP offset for a single sample. Assuming symmetric latency, the server time at
 * the response midpoint corresponds to our clock's midpoint (t0+t1)/2, so:
 *   offset(local - server) = (t0 + t1)/2 - tServer
 *   round-trip             = t1 - t0
 */
export function estimateOffset(sample: ClockSample): ClockOffsetEstimate {
  const midpoint = (sample.t0 + sample.t1) / 2;
  return {
    offsetMs: midpoint - sample.tServer,
    roundTripMs: sample.t1 - sample.t0,
  };
}

/**
 * Rolling clock-offset estimator. Keeps the most recent N samples and reports the
 * median offset (robust to latency spikes / outlier round-trips). A smaller
 * round-trip generally means a more trustworthy sample, but the median already
 * suppresses the noisy ones without needing a weighting scheme we can't yet
 * justify.
 */
export class ClockSynchronizer {
  readonly #window: number;
  readonly #samples: ClockOffsetEstimate[] = [];

  constructor(window = 16) {
    if (window < 1) throw new Error('window must be >= 1');
    this.#window = window;
  }

  add(sample: ClockSample): ClockOffsetEstimate {
    const est = estimateOffset(sample);
    this.#samples.push(est);
    if (this.#samples.length > this.#window) this.#samples.shift();
    return est;
  }

  /** Median offset (local - server) in ms, or null if no samples yet. */
  offsetMs(): number | null {
    if (this.#samples.length === 0) return null;
    const sorted = this.#samples.map((s) => s.offsetMs).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }

  /**
   * Signed drift of our local clock vs server (ms), i.e. the median offset.
   * This is what feeds FeedHealth.clock_drift_ms for the `clock` source.
   */
  driftMs(): number | null {
    return this.offsetMs();
  }

  /** True when we have an estimate and |drift| is within the ceiling. */
  synced(maxClockDriftMs: number): boolean {
    const drift = this.driftMs();
    return drift !== null && Math.abs(drift) <= maxClockDriftMs;
  }

  get sampleCount(): number {
    return this.#samples.length;
  }
}
