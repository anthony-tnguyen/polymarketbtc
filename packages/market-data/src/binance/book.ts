import type { BTCState } from '@pmbtc/contracts';
import type { EpochMillis } from '@pmbtc/contracts';
import { Ladder } from '../ladder.js';
import {
  BinanceDepthDiff,
  type BinanceDepthSnapshot,
  parseLevels,
} from './messages.js';

/** Outcome of applying a diff to the book. */
export type ApplyResult =
  | { kind: 'applied' }
  | { kind: 'buffered' } // pre-snapshot, held until sync
  | { kind: 'stale' } // older than snapshot, discarded
  | { kind: 'gap'; expectedU: number; gotU: number }; // contiguity break → resync

/**
 * Binance spot depth book with the documented update-id sync algorithm and gap
 * detection (market-data/ASSUMPTIONS.md, Binance). Pure and deterministic: it
 * takes parsed frames + the receive timestamp and holds no wall-clock/RNG.
 *
 * Lifecycle: construct → `applyDiff` buffers events → `sync(snapshot)` anchors
 * to a REST snapshot and replays the buffer → subsequent `applyDiff` must be
 * contiguous. On a gap, the caller re-fetches a snapshot and calls `sync` again.
 */
export class BinanceDepthBook {
  readonly #symbol: string;
  readonly #ladder = new Ladder();
  #lastUpdateId: number | null = null; // u of last applied event
  #synced = false;
  #buffer: BinanceDepthDiff[] = [];
  #lastExchangeTs: EpochMillis = 0;
  #gap = false;

  constructor(symbol: string) {
    this.#symbol = symbol;
  }

  get synced(): boolean {
    return this.#synced;
  }

  get gapDetected(): boolean {
    return this.#gap;
  }

  /** Apply a diff event. Before sync, events are buffered. */
  applyDiff(diff: BinanceDepthDiff): ApplyResult {
    this.#lastExchangeTs = diff.E;

    if (!this.#synced) {
      this.#buffer.push(diff);
      return { kind: 'buffered' };
    }

    // Already synced: enforce contiguity against the last applied id.
    const prevU = this.#lastUpdateId!;
    if (diff.u <= prevU) return { kind: 'stale' }; // already seen
    if (diff.U !== prevU + 1) {
      this.#gap = true;
      this.#synced = false;
      this.#ladder.clear();
      return { kind: 'gap', expectedU: prevU + 1, gotU: diff.U };
    }
    this.#applyLevels(diff);
    this.#lastUpdateId = diff.u;
    return { kind: 'applied' };
  }

  /**
   * Anchor to a REST snapshot and replay buffered diffs per the sync algorithm:
   * discard diffs with u <= lastUpdateId; the first applied diff must satisfy
   * U <= lastUpdateId+1 <= u; then require contiguity.
   */
  sync(snapshot: BinanceDepthSnapshot): void {
    this.#ladder.replace(parseLevels(snapshot.bids), parseLevels(snapshot.asks));
    let last = snapshot.lastUpdateId;
    let anchored = false;
    for (const diff of this.#buffer) {
      if (diff.u <= last) continue; // stale relative to snapshot
      if (!anchored) {
        // First applicable diff must straddle lastUpdateId+1.
        if (!(diff.U <= last + 1 && last + 1 <= diff.u)) {
          // Buffer doesn't line up with snapshot; need a newer snapshot.
          continue;
        }
        anchored = true;
      } else if (diff.U !== last + 1) {
        // Contiguity broke within the buffer → give up, caller re-snapshots.
        this.#buffer = [];
        this.#gap = true;
        return;
      }
      this.#applyLevels(diff);
      last = diff.u;
    }
    this.#buffer = [];
    this.#lastUpdateId = last;
    this.#synced = true;
    this.#gap = false;
  }

  #applyLevels(diff: BinanceDepthDiff): void {
    for (const [p, s] of parseLevels(diff.b)) this.#ladder.apply('bid', p, s);
    for (const [p, s] of parseLevels(diff.a)) this.#ladder.apply('ask', p, s);
  }

  /**
   * Snapshot the current BTC state (price = mid of top-of-book). Returns null
   * until synced with both sides populated. `receiveTs` is the local receive
   * time stamped by the edge (SystemClock), kept distinct from exchange time.
   */
  toBTCState(receiveTs: EpochMillis): BTCState | null {
    if (!this.#synced) return null;
    const bid = this.#ladder.bestBid();
    const ask = this.#ladder.bestAsk();
    const mid = this.#ladder.mid();
    if (bid === null || ask === null || mid === null) return null;
    return {
      symbol: this.#symbol,
      timestamps: { exchange_timestamp: this.#lastExchangeTs, receive_timestamp: receiveTs },
      price: mid,
      bid,
      ask,
      sequence: this.#lastUpdateId,
      gap_detected: this.#gap,
    };
  }
}
