import { z } from 'zod';
import {
  EpochMillis,
  MarketId,
  Price01,
  Probability,
  Side,
  Size,
  Usd,
  Version,
  VolatilityRegime,
} from './common.js';

/**
 * The canonical Opportunity object. The scanner reduces every candidate market
 * to one of these; it is a *proposal*, not a decision. It becomes a TradeIntent
 * only after the hard gates pass AND ev_lower_confidence_bound > 0
 * (MATH_SPEC §Entry, TRADING_INVARIANTS summary gate table).
 *
 * All price/EV quantities are EXECUTABLE (never midpoint, Invariant I2) and net
 * EV EXCLUDES rebates (Invariant I11).
 */
export const Opportunity = z.object({
  // ── identity / context ────────────────────────────────────────────────
  market: MarketId,
  strike: z.number().positive(),
  side: Side,

  btc_price: z.number().positive(),
  seconds_remaining: z.number().nonnegative(),

  distance_sigma: z.number(),
  volatility_regime: VolatilityRegime,

  // ── microstructure features (point-in-time, representative window) ─────
  target_velocity: z.number(),
  target_acceleration: z.number(),

  ofi: z.number(),
  obi: z.number().min(-1).max(1),
  microalpha: z.number(),

  // ── executable book ───────────────────────────────────────────────────
  poly_bid: Price01,
  poly_ask: Price01,
  spread: z.number().nonnegative(),
  depth: Size,

  // ── model outputs ──────────────────────────────────────────────────────
  fair_probability: Probability,

  /** First-passage probabilities on the canonical grid: P(T_q <= h). */
  p_tp_05_60s: Probability,
  p_tp_05_180s: Probability,
  p_tp_10_60s: Probability,
  p_tp_10_180s: Probability,

  p_tp_before_stop: Probability,

  expected_mfe: z.number(),
  expected_mae: z.number(),

  /** Target/horizon that maximize EV(q, h) (MATH_SPEC §Target/Horizon). */
  optimal_target: z.number().positive(),
  optimal_horizon: z.number().positive(),

  // ── execution economics ────────────────────────────────────────────────
  maker_fill_probability: Probability,
  taker_fill_probability: Probability,

  /** Net expected value (rebates excluded) and its lower-confidence bound. */
  expected_net_ev: Usd,
  ev_lower_confidence_bound: Usd,

  /** Conditional value-at-risk at 95% (expected loss in worst 5% tail). */
  cvar95: Usd,

  // ── recommendation ─────────────────────────────────────────────────────
  recommended_entry: Price01,
  recommended_size: Size,
  recommended_exit: Price01,

  // ── provenance ─────────────────────────────────────────────────────────
  model_version: Version,
  /** When the scanner produced this opportunity. */
  scanned_at: EpochMillis,
});
export type Opportunity = z.infer<typeof Opportunity>;
