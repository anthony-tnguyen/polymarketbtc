import { z } from 'zod';

/**
 * Shared primitives used across every contract.
 *
 * Conventions (enforced here so no downstream package re-invents them):
 *  - All timestamps are epoch **milliseconds** as integers (UTC). We never pass
 *    around formatted date strings on the hot path.
 *  - Every ingested event carries BOTH an exchange timestamp (source of truth
 *    for ordering/latency) and a receive timestamp (local). See TimestampPair.
 *  - Probabilities are in [0, 1]. Polymarket prices are also in [0, 1] (a
 *    contract pays 1 on YES), so we keep a distinct `Price01` for clarity.
 *  - IDs are branded strings so you cannot accidentally pass a market id where
 *    an order id is expected.
 */

/** Epoch milliseconds, UTC. Integer, non-negative. */
export const EpochMillis = z.number().int().nonnegative();
export type EpochMillis = z.infer<typeof EpochMillis>;

/** A probability in [0, 1]. */
export const Probability = z.number().min(0).max(1);
export type Probability = z.infer<typeof Probability>;

/** A Polymarket price in [0, 1] (contract pays 1.0 on YES resolution). */
export const Price01 = z.number().min(0).max(1);
export type Price01 = z.infer<typeof Price01>;

/** A non-negative size/quantity (shares/contracts). */
export const Size = z.number().nonnegative();
export type Size = z.infer<typeof Size>;

/** USD amount; may be negative (P&L, drawdown). */
export const Usd = z.number();
export type Usd = z.infer<typeof Usd>;

/** Both timestamps for an ingested event. Never collapse these (I5/I6). */
export const TimestampPair = z.object({
  /** Timestamp from the source exchange/venue. Source of truth for ordering. */
  exchange_timestamp: EpochMillis,
  /** Timestamp when our process received the event. Used for latency/staleness. */
  receive_timestamp: EpochMillis,
});
export type TimestampPair = z.infer<typeof TimestampPair>;

/** Branded id helper. */
const brandedId = <B extends string>(brand: B) =>
  z.string().min(1).brand(brand);

export const MarketId = brandedId('MarketId');
export type MarketId = z.infer<typeof MarketId>;

/**
 * Polymarket US market slug — the venue's primary market identifier on the
 * Markets WebSocket (`marketSlug`). On the US venue a contract/outcome is
 * identified by slug + direction, not by a CLOB ERC-1155 token id.
 */
export const MarketSlug = brandedId('MarketSlug');
export type MarketSlug = z.infer<typeof MarketSlug>;

/**
 * Venue-neutral identifier for a single tradeable outcome of a market. The
 * recorder/book/state path keys on this so it does not care whether the venue
 * uses slug+direction (Polymarket US) or an ERC-1155 token id (international
 * CLOB). The discovery layer maps the venue's native identity to this.
 */
export const OutcomeId = brandedId('OutcomeId');
export type OutcomeId = z.infer<typeof OutcomeId>;

/**
 * Polymarket CLOB token id (one per outcome). RETAINED for the international
 * CLOB only, which this project does NOT trade. Not used on the Polymarket US
 * recorder path — outcome identity there is {@link OutcomeId} / slug+direction.
 * Kept so a future FIXED_STRIKE/international adapter can reference it.
 */
export const TokenId = brandedId('TokenId');
export type TokenId = z.infer<typeof TokenId>;

export const IntentId = brandedId('IntentId');
export type IntentId = z.infer<typeof IntentId>;

export const OrderId = brandedId('OrderId');
export type OrderId = z.infer<typeof OrderId>;

export const PositionId = brandedId('PositionId');
export type PositionId = z.infer<typeof PositionId>;

/** Client-generated order id (idempotency key we control). */
export const ClientOrderId = brandedId('ClientOrderId');
export type ClientOrderId = z.infer<typeof ClientOrderId>;

/**
 * Direction of the Polymarket US BTC hourly Up/Down product's two outcomes. The
 * contract resolves by comparing the settlement reference (CF Benchmarks BRTI)
 * against the opening reference: `UP` pays if BTC closed above the opening
 * reference, `DOWN` if at/below. This is the authoritative outcome discriminator
 * for the production (`BTC_UP_DOWN_REFERENCE`) product on the recorder path.
 */
export const Direction = z.enum(['UP', 'DOWN']);
export type Direction = z.infer<typeof Direction>;

/**
 * Legacy binary outcome label (YES/NO). RETAINED for the not-yet-built execution
 * path and for true binary (FIXED_STRIKE/TOUCH) markets. For the production
 * Polymarket US Up/Down product, {@link Direction} is authoritative; do not
 * introduce new YES/NO assumptions on the recorder path.
 */
export const Side = z.enum(['YES', 'NO']);
export type Side = z.infer<typeof Side>;

/**
 * Discriminant for the kind of market a {@link MarketDefinition} represents.
 *  - `BTC_UP_DOWN_REFERENCE`: the production Polymarket US hourly Up/Down product
 *    (resolves from a reference-vs-reference comparison). Fully supported.
 *  - `FIXED_STRIKE`: a true fixed-strike above/below market. Reserved; fail-closed.
 *  - `TOUCH`: a barrier/touch market. Reserved; fail-closed.
 * Only `BTC_UP_DOWN_REFERENCE` is tradeable in the current scope; the validator
 * fails closed on the reserved types (Invariant I1).
 */
export const MarketType = z.enum(['BTC_UP_DOWN_REFERENCE', 'FIXED_STRIKE', 'TOUCH']);
export type MarketType = z.infer<typeof MarketType>;

/** Market types the current production scope fully supports and will trade. */
export const SUPPORTED_MARKET_TYPES = ['BTC_UP_DOWN_REFERENCE'] as const satisfies readonly MarketType[];

/**
 * Official settlement/reference price source. `CF_BRTI` (CF Benchmarks BRTI) is
 * the resolution reference for the Polymarket US hourly BTC product. Binance is
 * deliberately NOT a settlement source — it is a predictive/microstructure feed
 * only (see TRADING_INVARIANTS I15).
 */
export const ReferenceSource = z.enum(['CF_BRTI']);
export type ReferenceSource = z.infer<typeof ReferenceSource>;

/** Discrete volatility regime; drives model `supported_regime` gating. */
export const VolatilityRegime = z.enum(['low', 'normal', 'elevated', 'extreme']);
export type VolatilityRegime = z.infer<typeof VolatilityRegime>;

/**
 * Which data feed. `binance` = fast alpha / microstructure driver (predictive,
 * never settlement truth); `brti` = CF Benchmarks BRTI official reference /
 * settlement feed; `polymarket` = the traded Polymarket US contract book;
 * `clock` = the clock-sync pseudo-feed.
 */
export const FeedSource = z.enum(['binance', 'brti', 'polymarket', 'clock']);
export type FeedSource = z.infer<typeof FeedSource>;

/**
 * Version string for schemas/features/models, e.g. "v001". A single scheme so
 * feature_version on a model can be compared to the running feature engine.
 */
export const Version = z.string().regex(/^v\d{3,}$/, 'expected vNNN, e.g. v001');
export type Version = z.infer<typeof Version>;

/**
 * Current version of the FeatureVector schema produced by packages/features.
 * v002: split btc_ / poly_ flow features, added basis_usd/basis_bps, and
 * reframed distance from fixed-strike to BRTI opening-reference semantics.
 */
export const FEATURE_VERSION = 'v002' satisfies z.infer<typeof Version>;

/** A closed time range [start, end) in epoch millis. */
export const TimeRange = z
  .object({ start: EpochMillis, end: EpochMillis })
  .refine((r) => r.end >= r.start, { message: 'end must be >= start' });
export type TimeRange = z.infer<typeof TimeRange>;
