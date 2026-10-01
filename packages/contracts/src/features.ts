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

  /** Signed distance of BTC from strike in units of expected move remaining. */
  distance_sigma: z.number(),

  /** EWMA of underlying returns (volatility estimate). */
  ewma_volatility: z.number().nonnegative(),
  /** Short-window vol / long-window vol (regime proxy). */
  volatility_ratio: z.number().nonnegative(),

  /** Rate of change of BTC toward the strike, per lookback window. */
  target_velocity_5s: z.number(),
  target_velocity_15s: z.number(),
  target_velocity_30s: z.number(),
  target_velocity_60s: z.number(),
  /** Change in target velocity. */
  target_acceleration: z.number(),

  /** Order-flow imbalance of the Polymarket book, per window. */
  ofi_5s: z.number(),
  ofi_15s: z.number(),
  ofi_30s: z.number(),
  ofi_60s: z.number(),

  /** Order-book imbalance at 1 / 5 / 10 levels, in [-1, 1]. */
  obi_l1: z.number().min(-1).max(1),
  obi_l5: z.number().min(-1).max(1),
  obi_l10: z.number().min(-1).max(1),

  /** Short-horizon fair-value drift estimate from microstructure. */
  microalpha: z.number(),

  /** Book-shape features. */
  spread: z.number().nonnegative(),
  depth: z.number().nonnegative(),
  quote_velocity: z.number().nonnegative(),
  /** Deviation of the observed ladder from its fitted shape. */
  ladder_residual: z.number(),

  /** Discrete regime label derived from volatility_ratio. */
  volatility_regime: VolatilityRegime,
});
export type FeatureVector = z.infer<typeof FeatureVector>;
