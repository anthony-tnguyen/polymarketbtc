import { z } from 'zod';

/**
 * Raw Binance spot market-stream frames we consume, validated at the edge with
 * Zod. We model only what the BTC driver needs. Field names are Binance's
 * single-letter wire names; see market-data/ASSUMPTIONS.md (Binance).
 */

/** A [priceString, sizeString] level as Binance encodes it. */
const RawLevel = z.tuple([z.string(), z.string()]);
export type RawLevel = z.infer<typeof RawLevel>;

/** `<symbol>@depth@100ms` diff event. */
export const BinanceDepthDiff = z.object({
  e: z.literal('depthUpdate'),
  /** Event time, epoch millis. */
  E: z.number().int().nonnegative(),
  s: z.string(),
  /** First update id in event. */
  U: z.number().int().nonnegative(),
  /** Final update id in event. */
  u: z.number().int().nonnegative(),
  /** Bid updates (size "0" removes the level). */
  b: z.array(RawLevel),
  /** Ask updates. */
  a: z.array(RawLevel),
});
export type BinanceDepthDiff = z.infer<typeof BinanceDepthDiff>;

/**
 * REST depth snapshot (GET /api/v3/depth). Carries `lastUpdateId` used to anchor
 * the diff stream (ASSUMPTION B1 sync algorithm).
 */
export const BinanceDepthSnapshot = z.object({
  lastUpdateId: z.number().int().nonnegative(),
  bids: z.array(RawLevel),
  asks: z.array(RawLevel),
});
export type BinanceDepthSnapshot = z.infer<typeof BinanceDepthSnapshot>;

/** Parse [string,string] levels into [number,number] pairs. */
export function parseLevels(raw: readonly RawLevel[]): [number, number][] {
  return raw.map(([p, s]) => [Number(p), Number(s)]);
}
