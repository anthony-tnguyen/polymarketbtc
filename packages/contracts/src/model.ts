import { z } from 'zod';
import {
  EpochMillis,
  MarketId,
  Probability,
  Side,
  TimeRange,
  Version,
  VolatilityRegime,
} from './common.js';

/**
 * One first-passage probability estimate: P(T_q <= h | X_t) — the probability
 * that the executable bid reaches profit target `q` within horizon `h`.
 * (MATH_SPEC §First passage.)
 */
export const TargetProbability = z.object({
  /** Profit target as a fraction of dollar-at-risk, e.g. 0.05 = 0.5% ... 0.10. */
  target: z.number().positive(),
  /** Horizon in seconds. */
  horizon_seconds: z.number().positive(),
  /** P(T_target <= horizon | X_t). */
  probability: Probability,
});
export type TargetProbability = z.infer<typeof TargetProbability>;

/**
 * Metadata every frozen model artifact (models/*.json) must declare. The trader
 * refuses to use an artifact whose feature_version does not match the running
 * feature engine or whose supported_regime excludes the current regime.
 */
export const ModelArtifactMeta = z.object({
  model_version: Version,
  feature_version: Version,
  training_range: TimeRange,
  validation_range: TimeRange,
  /** Arbitrary reported metrics (calibration, Brier, C-index, ...). */
  metrics: z.record(z.string(), z.number()),
  /** Regimes this model is validated for; gates `model_supported`. */
  supported_regime: z.array(VolatilityRegime).nonempty(),
});
export type ModelArtifactMeta = z.infer<typeof ModelArtifactMeta>;

/**
 * Output of the model ensemble for one market/side at one decision time. All
 * fields are derived from a FeatureVector of matching feature_version.
 */
export const ModelPrediction = z.object({
  market_id: MarketId,
  side: Side,
  predicted_at: EpochMillis,
  model_version: Version,
  feature_version: Version,

  /** Market-implied fair probability of the target event. */
  fair_probability: Probability,

  /** First-passage probabilities across the target/horizon grid. */
  target_probabilities: z.array(TargetProbability).nonempty(),

  /** P(T_TP < T_STOP | X_t) for the competing-risks race. */
  p_tp_before_stop: Probability,

  /** Model estimates of executable MFE/MAE (fractions of dollar-at-risk). */
  expected_mfe: z.number(),
  expected_mae: z.number(),

  /** Regime the prediction was made under (for audit against supported_regime). */
  regime: VolatilityRegime,
});
export type ModelPrediction = z.infer<typeof ModelPrediction>;
