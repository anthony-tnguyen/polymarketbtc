import type {
  BTCState,
  EpochMillis,
  PolymarketBook,
  ReferenceBasis,
  ReferencePriceState,
  UnifiedMarketState,
} from '@pmbtc/contracts';
import { ageMs } from '@pmbtc/core';

export interface AssembleUnifiedStateInput {
  btc: BTCState;
  book: PolymarketBook;
  /** Latest official reference (BRTI) state, or null if none seen yet. */
  reference?: ReferencePriceState | null;
  /** Clock time at which this state is assembled. */
  now: EpochMillis;
  /** Market close time, for seconds_remaining. */
  closeTime: EpochMillis;
  /** Staleness ceilings (I5/I6). */
  maxBinanceAgeMs: number;
  maxPolymarketAgeMs: number;
}

/**
 * Compute the Binance−BRTI basis. `binance` is the fast predictive driver; `brti`
 * is the official reference. Signed `binance − brti`, in USD and in basis points
 * of the BRTI price. These become model features (ReferenceBasis).
 */
export function computeBasis(
  binancePrice: number,
  brti: ReferencePriceState,
  timestamps: ReferenceBasis['timestamps'],
): ReferenceBasis {
  const basisUsd = binancePrice - brti.reference_price;
  return {
    timestamps,
    binance_price: binancePrice,
    brti_price: brti.reference_price,
    basis_usd: basisUsd,
    basis_bps: (basisUsd / brti.reference_price) * 10_000,
  };
}

/**
 * Merge the latest BTC state (predictive), BRTI reference (settlement truth), and
 * Polymarket US book into a UnifiedMarketState with a freshness snapshot and the
 * Binance−BRTI basis. Pure/deterministic (time is injected via `now`). The
 * `tradeable` flag is a convenience composite over BTC + book; the risk/entry
 * engines still run their own gates (including BRTI-freshness where settlement
 * reasoning needs it).
 */
export function assembleUnifiedState(input: AssembleUnifiedStateInput): UnifiedMarketState {
  const btcAge = ageMs(input.now, input.btc.timestamps.exchange_timestamp);
  const bookAge = ageMs(input.now, input.book.timestamps.exchange_timestamp);
  const secondsRemaining = Math.max(0, (input.closeTime - input.now) / 1000);

  const reference = input.reference ?? null;
  const referenceAge = reference === null ? null : ageMs(input.now, reference.reference_timestamp);
  const basis =
    reference === null
      ? null
      : computeBasis(input.btc.price, reference, {
          exchange_timestamp: Math.max(
            input.btc.timestamps.exchange_timestamp,
            reference.reference_timestamp,
          ),
          receive_timestamp: input.now,
        });

  const tradeable =
    !input.btc.gap_detected &&
    !input.book.gap_detected &&
    btcAge <= input.maxBinanceAgeMs &&
    bookAge <= input.maxPolymarketAgeMs &&
    secondsRemaining > 0;

  return {
    market_id: input.book.market_id,
    direction: input.book.direction,
    as_of: input.now,
    btc: input.btc,
    reference,
    basis,
    book: input.book,
    seconds_remaining: secondsRemaining,
    btc_age_ms: btcAge,
    book_age_ms: bookAge,
    reference_age_ms: referenceAge,
    tradeable,
  };
}
