import { z } from 'zod';
import {
  EpochMillis,
  MarketId,
  Price01,
  Side,
  TimestampPair,
  TokenId,
  Version,
} from './common.js';

/**
 * A fully discovered + rule-validated Polymarket BTC hourly target-price market.
 *
 * `rules_validated` is the gate behind Invariant I1: it is `true` only when the
 * rules parser fully understood the resolution rules and they matched the
 * expected template. The trader NEVER acts on a market with
 * rules_validated=false (the `market_valid` entry gate fails closed).
 */
export const MarketDefinition = z.object({
  market_id: MarketId,
  /** Human-readable market title/question as listed. */
  question: z.string().min(1),
  /** Underlying asset symbol, e.g. "BTCUSDT" on Binance. */
  underlying: z.string().min(1),
  /** The target/strike price in USD the contract resolves against. */
  strike: z.number().positive(),
  /**
   * Comparator that defines a YES resolution relative to the strike:
   *  - 'above'       : settles YES if underlying is at/above strike at close
   *  - 'below'       : settles YES if at/below strike at close
   *  - 'touch_above' : settles YES if underlying touches >= strike any time
   *  - 'touch_below' : settles YES if underlying touches <= strike any time
   */
  comparator: z.enum(['above', 'below', 'touch_above', 'touch_below']),
  /** The hour window the market covers (resolution boundaries). */
  open_time: EpochMillis,
  close_time: EpochMillis,
  /** Settlement data source as parsed from the rules (e.g. a specific index). */
  settlement_source: z.string().min(1),
  /** CLOB token id per outcome side. */
  token_ids: z.object({ YES: TokenId, NO: TokenId }),
  /** Minimum price increment on the book. */
  tick_size: Price01.refine((t) => t > 0, 'tick_size must be > 0'),
  /** Minimum order size accepted by the venue. */
  min_order_size: z.number().positive(),
  /**
   * TRUE only when the rules parser fully validated resolution rules against
   * the expected template. Invariant I1 — the trader refuses to trade when false.
   */
  rules_validated: z.boolean(),
  /** Why validation failed/succeeded, for audit. */
  validation_notes: z.string().optional(),
  /** Version of the rules-parser template used to validate this market. */
  rules_parser_version: Version,
  /** When this definition was discovered/validated. */
  discovered_at: EpochMillis,
});
export type MarketDefinition = z.infer<typeof MarketDefinition>;

/**
 * A point-in-time snapshot of a market: the merged view the pipeline evaluates.
 * Overlapping snapshots within an hour are heavily autocorrelated — see
 * Invariant I10 for why they must never be randomly train/test split.
 */
export const MarketSnapshot = z.object({
  market_id: MarketId,
  /** The outcome side this snapshot is framed around (the target-facing side). */
  side: Side,
  timestamps: TimestampPair,
  /** Seconds remaining until market close at snapshot time. */
  seconds_remaining: z.number().nonnegative(),
  /** Best executable book prices for `side` at snapshot (not midpoint). */
  best_bid: Price01.nullable(),
  best_ask: Price01.nullable(),
  /** Underlying (BTC) price at snapshot time, from Binance. */
  underlying_price: z.number().positive(),
  /** Feature schema version in effect when this snapshot was produced. */
  feature_version: Version,
});
export type MarketSnapshot = z.infer<typeof MarketSnapshot>;
