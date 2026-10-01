import type {
  BTCState,
  EpochMillis,
  PolymarketBook,
  UnifiedMarketState,
} from '@pmbtc/contracts';
import { ageMs } from '@pmbtc/core';

export interface AssembleUnifiedStateInput {
  btc: BTCState;
  book: PolymarketBook;
  /** Clock time at which this state is assembled. */
  now: EpochMillis;
  /** Market close time, for seconds_remaining. */
  closeTime: EpochMillis;
  /** Staleness ceilings (I5/I6). */
  maxBinanceAgeMs: number;
  maxPolymarketAgeMs: number;
}

/**
 * Merge the latest BTC state and Polymarket book into a UnifiedMarketState with
 * a freshness snapshot. Pure/deterministic (time is injected via `now`). The
 * `tradeable` flag is a convenience composite; the risk/entry engines still run
 * their own gates.
 */
export function assembleUnifiedState(input: AssembleUnifiedStateInput): UnifiedMarketState {
  const btcAge = ageMs(input.now, input.btc.timestamps.exchange_timestamp);
  const bookAge = ageMs(input.now, input.book.timestamps.exchange_timestamp);
  const secondsRemaining = Math.max(0, (input.closeTime - input.now) / 1000);

  const tradeable =
    !input.btc.gap_detected &&
    !input.book.gap_detected &&
    btcAge <= input.maxBinanceAgeMs &&
    bookAge <= input.maxPolymarketAgeMs &&
    secondsRemaining > 0;

  return {
    market_id: input.book.market_id,
    side: input.book.side,
    as_of: input.now,
    btc: input.btc,
    book: input.book,
    seconds_remaining: secondsRemaining,
    btc_age_ms: btcAge,
    book_age_ms: bookAge,
    tradeable,
  };
}
