import { z } from 'zod';
import {
  Direction,
  EpochMillis,
  MarketId,
  MarketSlug,
  OutcomeId,
  Price01,
  ReferenceSource,
  TimeRange,
  TokenId,
  TimestampPair,
  Version,
} from './common.js';

/**
 * Fields common to every market type. Identity is venue-neutral: `market_id` is
 * our stable internal id and `market_slug` is the Polymarket US venue slug
 * (`marketSlug` on the Markets WS). Outcome identity lives per-type.
 *
 * `rules_validated` is the Invariant I1 gate: it is `true` only when the rules
 * parser fully understood the resolution rules AND the market is a type we
 * support. The trader NEVER acts on a market with `rules_validated=false`.
 */
const marketBase = {
  market_id: MarketId,
  /** Polymarket US venue market slug. */
  market_slug: MarketSlug,
  /** Human-readable market title/question as listed. */
  question: z.string().min(1),
  /** Underlying asset symbol, e.g. "BTCUSDT" on Binance (the driver feed). */
  underlying: z.string().min(1),
  /** The hour window the market covers (trading open/close boundaries). */
  open_time: EpochMillis,
  close_time: EpochMillis,
  /** Minimum price increment on the book. */
  tick_size: Price01.refine((t) => t > 0, 'tick_size must be > 0'),
  /** Minimum order size accepted by the venue. */
  min_order_size: z.number().positive(),
  /**
   * TRUE only when the rules parser fully validated resolution rules against the
   * expected template AND the market type is supported. Invariant I1 — the
   * trader refuses to trade when false.
   */
  rules_validated: z.boolean(),
  /** Why validation failed/succeeded, for audit. */
  validation_notes: z.string().optional(),
  /** Version of the rules-parser template used to validate this market. */
  rules_parser_version: Version,
  /** When this definition was discovered/validated. */
  discovered_at: EpochMillis,
} as const;

/**
 * One tradeable outcome of a market, identified venue-neutrally. For the
 * production Up/Down product there are exactly two outcomes (UP and DOWN).
 */
export const MarketOutcome = z.object({
  outcome_id: OutcomeId,
  direction: Direction,
});
export type MarketOutcome = z.infer<typeof MarketOutcome>;

/**
 * The production Polymarket US BTC hourly Up/Down product.
 *
 * It does NOT ask whether BTC "reaches a strike within the hour". It resolves by
 * comparing the official settlement reference (CF Benchmarks BRTI, over the
 * settlement window) against the opening reference (BRTI, over the opening
 * window): UP settles if BTC closed above the opening reference, DOWN otherwise.
 * Our edge is still path-dependent intrahour contract repricing — we exit before
 * settlement — but the settlement semantics are represented accurately here so
 * nothing downstream assumes a fixed strike/touch.
 */
export const BtcUpDownReferenceMarket = z.object({
  market_type: z.literal('BTC_UP_DOWN_REFERENCE'),
  ...marketBase,
  /** Source of the opening reference price (CF Benchmarks BRTI). */
  reference_source: ReferenceSource,
  /** Source of the settlement reference price (CF Benchmarks BRTI). */
  settlement_source: ReferenceSource,
  /**
   * The opening reference price (USD) the settlement is compared against. Null
   * before the opening reference window has resolved (market discovered early).
   */
  opening_reference_price: z.number().positive().nullable(),
  /** The opening reference window [start, end) the opening price is taken over. */
  reference_window: TimeRange,
  /** The settlement window [start, end) the settlement price is taken over. */
  settlement_window: TimeRange,
  /** The two directional outcomes (UP, DOWN). */
  outcomes: z.array(MarketOutcome).length(2),
});
export type BtcUpDownReferenceMarket = z.infer<typeof BtcUpDownReferenceMarket>;

/**
 * A true fixed-strike above/below market. RESERVED for future extensibility —
 * NOT supported in the current production scope. The validator fails closed on
 * it (rules_validated can never be true). `token_ids` is the international CLOB
 * identity scheme, retained only for a possible future adapter.
 */
export const FixedStrikeMarket = z.object({
  market_type: z.literal('FIXED_STRIKE'),
  ...marketBase,
  strike: z.number().positive(),
  comparator: z.enum(['above', 'below']),
  settlement_source: z.string().min(1),
  token_ids: z.object({ YES: TokenId, NO: TokenId }),
});
export type FixedStrikeMarket = z.infer<typeof FixedStrikeMarket>;

/**
 * A barrier/touch market (settles on whether the underlying touches a level).
 * RESERVED for future extensibility — NOT supported in the current scope. The
 * validator fails closed on it.
 */
export const TouchMarket = z.object({
  market_type: z.literal('TOUCH'),
  ...marketBase,
  strike: z.number().positive(),
  comparator: z.enum(['touch_above', 'touch_below']),
  settlement_source: z.string().min(1),
  token_ids: z.object({ YES: TokenId, NO: TokenId }),
});
export type TouchMarket = z.infer<typeof TouchMarket>;

/**
 * A fully discovered market, as a discriminated union over `market_type`. Only
 * `BTC_UP_DOWN_REFERENCE` is tradeable in the current scope; `FIXED_STRIKE` and
 * `TOUCH` are reserved and fail closed at rules validation (Invariant I1).
 */
export const MarketDefinition = z.discriminatedUnion('market_type', [
  BtcUpDownReferenceMarket,
  FixedStrikeMarket,
  TouchMarket,
]);
export type MarketDefinition = z.infer<typeof MarketDefinition>;

/**
 * A point-in-time snapshot of a market: the merged view the pipeline evaluates.
 * Overlapping snapshots within an hour are heavily autocorrelated — see
 * Invariant I10 for why they must never be randomly train/test split.
 */
export const MarketSnapshot = z.object({
  market_id: MarketId,
  /** The directional outcome this snapshot is framed around. */
  direction: Direction,
  timestamps: TimestampPair,
  /** Seconds remaining until market close at snapshot time. */
  seconds_remaining: z.number().nonnegative(),
  /** Best executable book prices for `direction` at snapshot (not midpoint). */
  best_bid: Price01.nullable(),
  best_ask: Price01.nullable(),
  /** Underlying (BTC) price at snapshot time, from Binance (predictive feed). */
  underlying_price: z.number().positive(),
  /** Opening reference price (BRTI) for the hour, if known. */
  opening_reference_price: z.number().positive().nullable(),
  /** Latest official reference price (BRTI) at snapshot time, if known. */
  reference_price: z.number().positive().nullable(),
  /** Feature schema version in effect when this snapshot was produced. */
  feature_version: Version,
});
export type MarketSnapshot = z.infer<typeof MarketSnapshot>;
