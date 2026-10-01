import type { EpochMillis, MarketId, PolymarketBook, Side, TokenId } from '@pmbtc/contracts';
import { Ladder } from '../ladder.js';
import type {
  PolymarketBookMessage,
  PolymarketPriceChangeMessage,
} from './messages.js';

/** Outcome of applying a price_change to the book. */
export type PolyApplyResult =
  | { kind: 'applied' }
  | { kind: 'dropped_unsynced' } // no snapshot yet; waiting for a `book` frame
  | { kind: 'desync'; side: 'bid' | 'ask'; expected: number; got: number }; // reconciliation failed

export interface PolymarketBookStateInit {
  market_id: MarketId;
  token_id: TokenId;
  side: Side;
}

/**
 * Polymarket book for a single outcome token. Because the channel has no
 * sequence number and the `hash` is opaque, integrity is enforced by
 * best-bid/ask reconciliation (market-data/ASSUMPTIONS.md P1): after applying a
 * price_change, the recomputed top-of-book must match the message's
 * best_bid/best_ask; a mismatch marks the book out-of-sync and we wait for the
 * next `book` snapshot. Pure and deterministic.
 */
export class PolymarketBookState {
  readonly #market: MarketId;
  readonly #token: TokenId;
  readonly #side: Side;
  readonly #ladder = new Ladder();
  #synced = false;
  #gap = false;
  #hash: string | null = null;
  #lastExchangeTs: EpochMillis = 0;

  constructor(init: PolymarketBookStateInit) {
    this.#market = init.market_id;
    this.#token = init.token_id;
    this.#side = init.side;
  }

  get synced(): boolean {
    return this.#synced;
  }

  get gapDetected(): boolean {
    return this.#gap;
  }

  /** Apply a full `book` snapshot. Fully replaces local state (ASSUMPTION P2). */
  applySnapshot(msg: PolymarketBookMessage): void {
    this.#ladder.replace(
      msg.bids.map((l) => [Number(l.price), Number(l.size)] as [number, number]),
      msg.asks.map((l) => [Number(l.price), Number(l.size)] as [number, number]),
    );
    this.#hash = msg.hash ?? null;
    this.#lastExchangeTs = Number(msg.timestamp);
    this.#synced = true;
    this.#gap = false;
  }

  /**
   * Apply a `price_change` delta, then reconcile top-of-book against the
   * message's best_bid/best_ask. Dropped if we have no snapshot yet.
   */
  applyPriceChange(msg: PolymarketPriceChangeMessage): PolyApplyResult {
    if (!this.#synced) return { kind: 'dropped_unsynced' };
    this.#lastExchangeTs = Number(msg.timestamp);

    // The last non-null best_bid / best_ask in the message reflect the resulting
    // book after all its changes are applied (ASSUMPTION P3).
    let expectedBid: number | null = null;
    let expectedAsk: number | null = null;

    for (const ch of msg.price_changes) {
      if (ch.asset_id !== this.#token) continue; // not our token
      const price = Number(ch.price);
      const size = Number(ch.size);
      this.#ladder.apply(ch.side === 'BUY' ? 'bid' : 'ask', price, size);
      if (ch.hash != null) this.#hash = ch.hash;
      if (ch.best_bid != null) expectedBid = Number(ch.best_bid);
      if (ch.best_ask != null) expectedAsk = Number(ch.best_ask);
    }

    // Reconcile. A mismatch means our local book drifted → desync.
    if (expectedBid !== null) {
      const got = this.#ladder.bestBid();
      if (got === null || got !== expectedBid) {
        this.#desync();
        return { kind: 'desync', side: 'bid', expected: expectedBid, got: got ?? NaN };
      }
    }
    if (expectedAsk !== null) {
      const got = this.#ladder.bestAsk();
      if (got === null || got !== expectedAsk) {
        this.#desync();
        return { kind: 'desync', side: 'ask', expected: expectedAsk, got: got ?? NaN };
      }
    }
    return { kind: 'applied' };
  }

  #desync(): void {
    this.#gap = true;
    this.#synced = false;
    this.#ladder.clear();
  }

  /**
   * Produce the contract PolymarketBook. `receiveTs` is the local receive time
   * stamped at the edge; it is kept distinct from the venue exchange_timestamp.
   */
  toBook(receiveTs: EpochMillis): PolymarketBook {
    return {
      market_id: this.#market,
      token_id: this.#token,
      side: this.#side,
      timestamps: { exchange_timestamp: this.#lastExchangeTs, receive_timestamp: receiveTs },
      bids: this.#ladder.levels('bid'),
      asks: this.#ladder.levels('ask'),
      sequence: null, // channel exposes no sequence number
      book_hash: this.#hash,
      gap_detected: this.#gap,
    };
  }
}
