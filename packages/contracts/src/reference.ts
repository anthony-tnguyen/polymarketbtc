import { z } from 'zod';
import { EpochMillis, ReferenceSource, TimestampPair } from './common.js';

/**
 * Official reference / settlement price state, kept SEPARATE from the Binance
 * driver (Invariant I15: Binance is predictive, never settlement truth).
 *
 * The Polymarket US hourly BTC Up/Down product resolves from CF Benchmarks BRTI
 * (the BRTI real-time index), compared between an opening reference window and a
 * settlement window. This is the authoritative feed for anything touching
 * resolution; the model may *predict* with Binance, but P&L/settlement semantics
 * are reasoned about against BRTI.
 */
export const ReferencePriceState = z.object({
  source: ReferenceSource,
  /** Latest reference price (USD). */
  reference_price: z.number().positive(),
  /** Source-provided timestamp of this reference value. */
  reference_timestamp: EpochMillis,
  /** The reference window this value falls in (hour open/settlement window). */
  window_start: EpochMillis,
  window_end: EpochMillis,
  /** Local receive time; kept distinct from the source timestamp (I5/I6). */
  receive_timestamp: EpochMillis,
  /** Staleness of this reference value in milliseconds at evaluation time. */
  freshness_ms: z.number().nonnegative(),
});
export type ReferencePriceState = z.infer<typeof ReferencePriceState>;

/**
 * Basis between the fast Binance driver and the official BRTI reference. These
 * become model features: a persistent, structured basis tells the model how far
 * the predictive feed is leading/lagging the settlement reference. Signed
 * `binance − brti`.
 */
export const ReferenceBasis = z.object({
  timestamps: TimestampPair,
  /** Binance BTC price used for the basis. */
  binance_price: z.number().positive(),
  /** BRTI reference price used for the basis. */
  brti_price: z.number().positive(),
  /** Signed basis in USD: `binance_price − brti_price`. */
  basis_usd: z.number(),
  /** Signed basis in basis points of the BRTI price. */
  basis_bps: z.number(),
});
export type ReferenceBasis = z.infer<typeof ReferenceBasis>;
