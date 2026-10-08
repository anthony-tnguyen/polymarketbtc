import { z } from 'zod';

/**
 * Venue identity + endpoint configuration — the single source of truth for WHICH
 * Polymarket we target. This project trades **Polymarket US** (polymarket.us),
 * the CFTC-regulated DCM/DCO operated by QCX LLC — NOT the international on-chain
 * CLOB (polymarket.com). The two are entirely separate stacks with different
 * endpoints, token structures, fee/order semantics, and WebSocket shapes, so a
 * single stray international endpoint in config is a correctness hazard: it would
 * point ingestion at a venue we do not trade. This module makes the target
 * explicit and FAILS CLOSED on any known-international endpoint.
 */

/** The one and only target venue for this project. */
export const TARGET_VENUE = 'POLYMARKET_US' as const;
export type TargetVenue = typeof TARGET_VENUE;

/** Canonical Polymarket US endpoints (confirm against docs.polymarket.us). */
export const POLYMARKET_US_ENDPOINTS = {
  /** Markets WebSocket: full book + stats, lite, trades. */
  marketsWs: 'wss://api.polymarket.us/v1/ws/markets',
  /** REST/HTTP API base. */
  restBase: 'https://api.polymarket.us',
} as const;

/**
 * Host fragments that identify the INTERNATIONAL Polymarket CLOB. Any config
 * value containing one of these is rejected: these venues are not our target and
 * their semantics (token ids, fees, order book, hash) do not apply to us. US
 * persons are close-only there, so it is never a trading target.
 */
export const INTERNATIONAL_POLYMARKET_HOSTS: readonly string[] = [
  'clob.polymarket.com',
  'ws-subscriptions-clob.polymarket.com',
  'gamma-api.polymarket.com',
  'strapi-matic.poly.market',
  'polymarket.com',
];

/** True if `value` references a known international Polymarket endpoint. */
export function isInternationalPolymarketEndpoint(value: string): boolean {
  const v = value.toLowerCase();
  // `polymarket.us` legitimately contains the string "polymarket" but is NOT
  // international; only match international hosts, and never match the US host.
  if (v.includes('polymarket.us') || v.includes('api.polymarket.us')) return false;
  return INTERNATIONAL_POLYMARKET_HOSTS.some((host) => v.includes(host));
}

/** A URL that must be a Polymarket US endpoint (rejects international hosts). */
const PolymarketUsUrl = z
  .string()
  .url()
  .refine((u) => !isInternationalPolymarketEndpoint(u), {
    message:
      'international Polymarket endpoint rejected: this project targets POLYMARKET_US (polymarket.us) only',
  })
  .refine((u) => u.toLowerCase().includes('polymarket.us'), {
    message: 'expected a polymarket.us endpoint',
  });

/**
 * Validated venue configuration. Construct from env via {@link parseVenueConfig};
 * the schema rejects any international Polymarket endpoint at the boundary so an
 * international host can never reach the ingestion layer.
 */
export const VenueConfig = z.object({
  venue: z.literal(TARGET_VENUE),
  /** Polymarket US Markets WebSocket URL. */
  polymarketWsUrl: PolymarketUsUrl,
  /** Polymarket US REST/HTTP base URL. */
  polymarketRestUrl: PolymarketUsUrl,
  /** Binance WS URL (the BTC driver feed; predictive only, not settlement). */
  binanceWsUrl: z.string().url(),
});
export type VenueConfig = z.infer<typeof VenueConfig>;

export interface VenueConfigEnv {
  POLYMARKET_VENUE?: string;
  POLYMARKET_WS_URL?: string;
  POLYMARKET_REST_URL?: string;
  BINANCE_WS_URL?: string;
}

/**
 * Parse + validate venue config from a raw env map. Throws (fail-closed) if the
 * venue is not POLYMARKET_US or any Polymarket endpoint is international. Defaults
 * the Polymarket endpoints to the canonical US ones when unset.
 */
export function parseVenueConfig(env: VenueConfigEnv): VenueConfig {
  return VenueConfig.parse({
    venue: env.POLYMARKET_VENUE ?? TARGET_VENUE,
    polymarketWsUrl: env.POLYMARKET_WS_URL ?? POLYMARKET_US_ENDPOINTS.marketsWs,
    polymarketRestUrl: env.POLYMARKET_REST_URL ?? POLYMARKET_US_ENDPOINTS.restBase,
    binanceWsUrl: env.BINANCE_WS_URL ?? 'wss://stream.binance.com:9443/ws',
  });
}
