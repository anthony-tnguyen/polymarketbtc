import type {
  Direction,
  EpochMillis,
  MarketId,
  MarketSlug,
  OutcomeId,
  PolymarketBook,
} from '@pmbtc/contracts';
import { Ladder } from '../ladder.js';
import { parseVenueTimestamp } from '../timestamp.js';
import { type MarketDataMessage } from './messages.js';

export interface PolymarketUsBookInit {
  market_id: MarketId;
  /** Polymarket US venue slug (`marketSlug` on the Markets WS). */
  market_slug: MarketSlug;
  /** Venue-neutral outcome identity for this contract. */
  outcome_id: OutcomeId;
  /** The directional outcome this book represents (UP/DOWN). */
  direction: Direction;
}

/**
 * Integrity anomalies observed while applying US WS frames. These feed the
 * feed-health layer (there is no sequence/gap concept on the US WS — see
 * ASSUMPTIONS.md). Reset per-message by {@link PolymarketUsBook.apply}.
 */
export interface PolymarketUsBookAnomalies {
  /** transactTime was absent/ambiguous/implausible (fell back to receive time). */
  timestamp_anomaly: boolean;
  /** Book had no levels on one or both sides. */
  empty_or_invalid_book: boolean;
  /** A level priced outside [0,1], or the book was crossed (best bid >= best ask). */
  impossible_prices: boolean;
}

/**
 * Polymarket US order book for a single outcome. The US Markets WebSocket sends
 * the FULL book on every `MarketData` message, so maintenance is simply "replace
 * the ladder each message" — there are no deltas, no hash, and no sequence
 * number to reconcile (market-data/ASSUMPTIONS.md, Polymarket US). Integrity is a
 * staleness/disconnect/validity concern surfaced via {@link anomalies} to the
 * feed-health layer, not a per-message desync concept. Pure and deterministic.
 */
export class PolymarketUsBook {
  readonly #market: MarketId;
  readonly #slug: MarketSlug;
  readonly #outcome: OutcomeId;
  readonly #direction: Direction;
  readonly #ladder = new Ladder();
  #hasData = false;
  #lastExchangeTs: EpochMillis = 0;
  /** Latest venue market state string (e.g. open/closed/resolved). */
  #state = '';
  #anomalies: PolymarketUsBookAnomalies = {
    timestamp_anomaly: false,
    empty_or_invalid_book: false,
    impossible_prices: false,
  };

  constructor(init: PolymarketUsBookInit) {
    this.#market = init.market_id;
    this.#slug = init.market_slug;
    this.#outcome = init.outcome_id;
    this.#direction = init.direction;
  }

  get hasData(): boolean {
    return this.#hasData;
  }

  get state(): string {
    return this.#state;
  }

  /** Integrity anomalies from the most recent {@link apply}. */
  get anomalies(): Readonly<PolymarketUsBookAnomalies> {
    return this.#anomalies;
  }

  /**
   * Apply a full `MarketData` snapshot, replacing the local book. `receiveTs` is
   * the local edge receive time, used as the exchange-time fallback when the
   * frame's `transactTime` is absent/ambiguous/implausible (the two timestamps
   * are kept distinct). Integrity anomalies are recorded, never thrown, so the
   * feed-health layer can degrade the feed deterministically.
   */
  apply(msg: MarketDataMessage, receiveTs: EpochMillis): void {
    const md = msg.marketData;
    const bids = md.bids.map((l) => [Number(l.px.value), Number(l.qty)] as [number, number]);
    const offers = md.offers.map((l) => [Number(l.px.value), Number(l.qty)] as [number, number]);

    this.#ladder.replace(bids, offers);
    this.#state = md.state;

    const ts = parseVenueTimestamp(md.transactTime);
    this.#lastExchangeTs = ts.ok ? ts.value.ms : receiveTs;

    const bestBid = this.#ladder.bestBid();
    const bestAsk = this.#ladder.bestAsk();
    const allPrices = [...bids, ...offers].map(([px]) => px);
    const impossiblePrice = allPrices.some((px) => !(px >= 0 && px <= 1));
    const crossed = bestBid !== null && bestAsk !== null && bestBid >= bestAsk;

    this.#anomalies = {
      timestamp_anomaly: !ts.ok,
      empty_or_invalid_book: bids.length === 0 || offers.length === 0,
      impossible_prices: impossiblePrice || crossed,
    };
    this.#hasData = true;
  }

  /** Produce the contract PolymarketBook. */
  toBook(receiveTs: EpochMillis): PolymarketBook {
    return {
      market_id: this.#market,
      market_slug: this.#slug,
      outcome_id: this.#outcome,
      direction: this.#direction,
      timestamps: { exchange_timestamp: this.#lastExchangeTs, receive_timestamp: receiveTs },
      bids: this.#ladder.levels('bid'),
      asks: this.#ladder.levels('ask'),
      sequence: null, // WS market-data carries no sequence number (FIX does)
      book_hash: null, // US WS carries no book hash
      gap_detected: false, // snapshot-per-message: no delta desync; staleness/validity handled by feed-health
    };
  }
}
