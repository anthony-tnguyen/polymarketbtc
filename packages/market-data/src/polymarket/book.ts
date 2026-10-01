import type { EpochMillis, MarketId, PolymarketBook, Side, TokenId } from '@pmbtc/contracts';
import { Ladder } from '../ladder.js';
import { type MarketDataMessage, parseTransactTime } from './messages.js';

export interface PolymarketUsBookInit {
  market_id: MarketId;
  /**
   * Token/contract identifier. The US WS identifies a contract by `marketSlug`;
   * the discovery layer maps that slug to this id and the outcome `side`. (How
   * US binary markets expose YES vs NO is an open question — see ASSUMPTIONS.md.)
   */
  token_id: TokenId;
  side: Side;
}

/**
 * Polymarket US order book for a single contract. The US Markets WebSocket sends
 * the FULL book on every `MarketData` message, so maintenance is simply "replace
 * the ladder each message" — there are no deltas, no hash, and no sequence
 * number to reconcile (market-data/ASSUMPTIONS.md, Polymarket US). Integrity is
 * therefore a staleness/disconnect concern handled by the feed-health layer, not
 * a per-message desync concept. Pure and deterministic.
 */
export class PolymarketUsBook {
  readonly #market: MarketId;
  readonly #token: TokenId;
  readonly #side: Side;
  readonly #ladder = new Ladder();
  #hasData = false;
  #lastExchangeTs: EpochMillis = 0;
  /** Latest venue market state string (e.g. open/closed/resolved). */
  #state = '';

  constructor(init: PolymarketUsBookInit) {
    this.#market = init.market_id;
    this.#token = init.token_id;
    this.#side = init.side;
  }

  get hasData(): boolean {
    return this.#hasData;
  }

  get state(): string {
    return this.#state;
  }

  /**
   * Apply a full `MarketData` snapshot, replacing the local book. `receiveTs` is
   * the local edge receive time, used as the exchange-time fallback when the
   * frame omits `transactTime`; the two timestamps are kept distinct.
   */
  apply(msg: MarketDataMessage, receiveTs: EpochMillis): void {
    const md = msg.marketData;
    this.#ladder.replace(
      md.bids.map((l) => [Number(l.px.value), Number(l.qty)] as [number, number]),
      md.offers.map((l) => [Number(l.px.value), Number(l.qty)] as [number, number]),
    );
    this.#state = md.state;
    this.#lastExchangeTs = parseTransactTime(md.transactTime, receiveTs);
    this.#hasData = true;
  }

  /** Produce the contract PolymarketBook. */
  toBook(receiveTs: EpochMillis): PolymarketBook {
    return {
      market_id: this.#market,
      token_id: this.#token,
      side: this.#side,
      timestamps: { exchange_timestamp: this.#lastExchangeTs, receive_timestamp: receiveTs },
      bids: this.#ladder.levels('bid'),
      asks: this.#ladder.levels('ask'),
      sequence: null, // WS market-data carries no sequence number (FIX does)
      book_hash: null, // US WS carries no book hash
      gap_detected: false, // snapshot-per-message: no delta desync; staleness handled by feed-health
    };
  }
}
