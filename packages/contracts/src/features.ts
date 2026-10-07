import { z } from 'zod';
import {
  MarketId,
  Side,
  TimestampPair,
  Version,
  VolatilityRegime,
} from './common.js';

/**
 * Deterministic feature vector produced by packages/features.
 *
 * DETERMINISM IS A HARD REQUIREMENT: replaying identical historical events must
 * produce an identical FeatureVector (MATH_SPEC §Determinism). No wall-clock, no
 * RNG, no iteration-order dependence on this path.
 *
 * `feature_version` must match a model's declared feature_version for that model
 * to be `model_supported` at the entry gate.
 */
export const FeatureVector = z.object({
  market_id: MarketId,
  side: Side,
  timestamps: TimestampPair,
  feature_version: Version,

  /**
   * Signed distance of BTC from the opening reference (BRTI) in units of
   * expected move over the remaining time. (NOT a fixed strike — the US product
   * resolves by reference comparison; see market.ts.)
   */
  distance_sigma: z.number(),

  /** EWMA of underlying (Binance) returns (volatility estimate). */
  ewma_volatility: z.number().nonnegative(),
  /** Short-window vol / long-window vol (regime proxy). */
  volatility_ratio: z.number().nonnegative(),

  /** Rate of change of BTC toward the opening reference, per lookback window. */
  target_velocity_5s: z.number(),
  target_velocity_15s: z.number(),
  target_velocity_30s: z.number(),
  target_velocity_60s: z.number(),
  /** Change in target velocity. */
  target_acceleration: z.number(),

  /**
   * Basis between the Binance driver and the BRTI reference (model feature; see
   * reference.ts ReferenceBasis). Underlying flow is NEVER conflated with
   * prediction-market flow.
   */
  basis_usd: z.number(),
  basis_bps: z.number(),

  // ── underlying (Binance) flow ───────────────────────────────────────────
  /** Order-flow imbalance of the Binance (BTC) book, per window. */
  btc_ofi_5s: z.number(),
  btc_ofi_15s: z.number(),
  btc_ofi_30s: z.number(),
  btc_ofi_60s: z.number(),
  /** Order-book imbalance of the Binance book, in [-1, 1]. */
  btc_obi: z.number().min(-1).max(1),
  /** Short-horizon fair-value drift estimate from BTC microstructure. */
  btc_microalpha: z.number(),

  // ── prediction-market (Polymarket US) flow ───────────────────────────────
  /** Order-flow imbalance of the Polymarket US book, per window. */
  poly_ofi_5s: z.number(),
  poly_ofi_15s: z.number(),
  poly_ofi_30s: z.number(),
  poly_ofi_60s: z.number(),
  /** Order-book imbalance of the Polymarket book at 1 / 5 / 10 levels, in [-1, 1]. */
  poly_obi_l1: z.number().min(-1).max(1),
  poly_obi_l5: z.number().min(-1).max(1),
  poly_obi_l10: z.number().min(-1).max(1),
  /** Rate at which the Polymarket quotes move (requotes/sec). */
  poly_quote_velocity: z.number().nonnegative(),

  /** Polymarket book-shape features. */
  spread: z.number().nonnegative(),
  depth: z.number().nonnegative(),
  /** Deviation of the observed Polymarket ladder from its fitted shape. */
  ladder_residual: z.number(),

  /** Discrete regime label derived from volatility_ratio. */
  volatility_regime: VolatilityRegime,
});
export type FeatureVector = z.infer<typeof FeatureVector>;
