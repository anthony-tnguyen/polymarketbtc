import { z } from 'zod';
import { EpochMillis, MarketId, Size, Usd } from './common.js';

/**
 * Hard risk limits, independent of any model logic. These always override
 * model sizing (Invariant I7): final size = min(KellySize, LiquidityCap,
 * StrikeCap, HourlyCap, DailyCap). The risk engine knows nothing about EV.
 *
 * Exposure caps are sizes/USD; the *_age / drift limits are milliseconds; the
 * rate limits are counts per rolling window.
 */
export const RiskLimits = z.object({
  MAX_POSITION: Size,
  MAX_STRIKE_EXPOSURE: Size,
  MAX_HOURLY_EXPOSURE: Size,
  MAX_DAILY_LOSS: Usd.nonnegative(),
  MAX_OPEN_POSITIONS: z.number().int().positive(),

  MAX_SPREAD: z.number().nonnegative(),
  MIN_DEPTH: Size,

  /** Feed staleness ceilings in milliseconds (Invariants I5, I6). */
  MAX_BINANCE_AGE: z.number().int().positive(),
  MAX_POLYMARKET_AGE: z.number().int().positive(),
  /** Clock drift ceiling in milliseconds (I5/I6/I14). */
  MAX_CLOCK_DRIFT: z.number().int().positive(),

  /** Fault-rate ceilings over a rolling window. */
  MAX_ORDER_REJECTS: z.number().int().nonnegative(),
  MAX_UNKNOWN_ORDERS: z.number().int().nonnegative(),
  /** Reconnects per minute before the feed is deemed unhealthy. */
  MAX_RECONNECT_RATE: z.number().nonnegative(),
});
export type RiskLimits = z.infer<typeof RiskLimits>;

/**
 * Live risk state. When `entries_frozen` is true (uncertain order state, I13) or
 * `orders_halted` is true (uncertain feed state, I14), the corresponding actions
 * are blocked regardless of model output.
 */
export const RiskState = z.object({
  evaluated_at: EpochMillis,

  /** Current utilization against the caps. */
  open_positions: z.number().int().nonnegative(),
  total_exposure: Size,
  /** Per-strike exposure keyed by market id. */
  strike_exposure: z.record(z.string(), Size),
  hourly_exposure: Size,
  daily_realized_pnl: Usd,

  /** Rolling fault counters. */
  order_rejects: z.number().int().nonnegative(),
  unknown_orders: z.number().int().nonnegative(),
  reconnect_rate: z.number().nonnegative(),

  /** Gate outputs. */
  risk_valid: z.boolean(),
  entries_frozen: z.boolean(),
  orders_halted: z.boolean(),

  /** Human-readable reasons for any active block, for audit/observability. */
  active_breaches: z.array(z.string()),

  /** The limits in force when this state was evaluated. */
  limits: RiskLimits,
});
export type RiskState = z.infer<typeof RiskState>;

/** Which market a per-strike exposure entry refers to (documentation helper). */
export const StrikeExposureKey = MarketId;
export type StrikeExposureKey = z.infer<typeof StrikeExposureKey>;
