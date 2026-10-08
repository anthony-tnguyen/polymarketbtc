import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Opportunity,
  MarketDefinition,
  RiskLimits,
  OrderStatus,
  FEATURE_VERSION,
  VenueConfig,
  parseVenueConfig,
  isInternationalPolymarketEndpoint,
  POLYMARKET_US_ENDPOINTS,
  ReferencePriceState,
  ReferenceBasis,
  RepricingObservation,
} from '@pmbtc/contracts';

const ts = { exchange_timestamp: 1_700_000_000_000, receive_timestamp: 1_700_000_000_050 };

function upDownMarket(overrides: Record<string, unknown> = {}) {
  return {
    market_type: 'BTC_UP_DOWN_REFERENCE',
    market_id: 'btc-1700000000',
    market_slug: 'btc-up-or-down-1700',
    question: 'Will BTC be up or down at 12:00 UTC?',
    underlying: 'BTCUSDT',
    open_time: 1_700_000_000_000,
    close_time: 1_700_003_600_000,
    reference_source: 'CF_BRTI',
    settlement_source: 'CF_BRTI',
    opening_reference_price: 65000,
    reference_window: { start: 1_700_000_000_000, end: 1_700_000_060_000 },
    settlement_window: { start: 1_700_003_540_000, end: 1_700_003_600_000 },
    outcomes: [
      { outcome_id: 'btc-1700-up', direction: 'UP' },
      { outcome_id: 'btc-1700-down', direction: 'DOWN' },
    ],
    tick_size: 0.01,
    min_order_size: 5,
    rules_validated: true,
    rules_parser_version: 'v001',
    discovered_at: 1_699_999_000_000,
    ...overrides,
  };
}

test('MarketDefinition accepts an Up/Down reference market and allows a null opening reference', () => {
  assert.equal(MarketDefinition.safeParse(upDownMarket()).success, true);
  assert.equal(MarketDefinition.safeParse(upDownMarket({ opening_reference_price: null })).success, true);
  // An unknown discriminant is rejected by the discriminated union.
  assert.equal(MarketDefinition.safeParse(upDownMarket({ market_type: 'MYSTERY' })).success, false);
  // Reserved types still parse structurally (fail-closed happens at rules validation).
  const touch = {
    market_type: 'TOUCH',
    market_id: 'm',
    market_slug: 's',
    question: 'q',
    underlying: 'BTCUSDT',
    open_time: 1,
    close_time: 2,
    strike: 65000,
    comparator: 'touch_above',
    settlement_source: 'some-oracle',
    token_ids: { YES: 'y', NO: 'n' },
    tick_size: 0.01,
    min_order_size: 5,
    rules_validated: false,
    rules_parser_version: 'v001',
    discovered_at: 1,
  };
  assert.equal(MarketDefinition.safeParse(touch).success, true);
});

test('VenueConfig rejects international Polymarket endpoints and accepts US', () => {
  assert.equal(isInternationalPolymarketEndpoint('wss://ws-subscriptions-clob.polymarket.com/ws/market'), true);
  assert.equal(isInternationalPolymarketEndpoint('https://clob.polymarket.com'), true);
  assert.equal(isInternationalPolymarketEndpoint(POLYMARKET_US_ENDPOINTS.marketsWs), false);
  assert.equal(isInternationalPolymarketEndpoint(POLYMARKET_US_ENDPOINTS.restBase), false);

  // Defaults to the canonical US endpoints.
  const cfg = parseVenueConfig({});
  assert.equal(cfg.venue, 'POLYMARKET_US');
  assert.equal(cfg.polymarketWsUrl, POLYMARKET_US_ENDPOINTS.marketsWs);

  // An international endpoint fails closed.
  assert.throws(() => parseVenueConfig({ POLYMARKET_WS_URL: 'wss://ws-subscriptions-clob.polymarket.com/ws/market' }));
  assert.throws(() => parseVenueConfig({ POLYMARKET_REST_URL: 'https://clob.polymarket.com' }));
  // A non-US venue literal fails closed.
  assert.equal(VenueConfig.safeParse({
    venue: 'POLYMARKET_INTL',
    polymarketWsUrl: POLYMARKET_US_ENDPOINTS.marketsWs,
    polymarketRestUrl: POLYMARKET_US_ENDPOINTS.restBase,
    binanceWsUrl: 'wss://stream.binance.com:9443/ws',
  }).success, false);
});

test('ReferencePriceState and ReferenceBasis enforce source and shape', () => {
  const ref = {
    source: 'CF_BRTI',
    reference_price: 65010,
    reference_timestamp: 1_700_000_000_000,
    window_start: 1_700_000_000_000,
    window_end: 1_700_000_060_000,
    receive_timestamp: 1_700_000_000_040,
    freshness_ms: 40,
  };
  assert.equal(ReferencePriceState.safeParse(ref).success, true);
  // Binance is never a reference source.
  assert.equal(ReferencePriceState.safeParse({ ...ref, source: 'binance' }).success, false);

  const basis = {
    timestamps: ts,
    binance_price: 65000,
    brti_price: 65010,
    basis_usd: -10,
    basis_bps: -1.538,
  };
  assert.equal(ReferenceBasis.safeParse(basis).success, true);
});

test('RepricingObservation keeps lags nullable (censoring)', () => {
  const obs = {
    market_id: 'btc-1700',
    direction: 'UP',
    observed_at: 1_700_000_000_500,
    trigger: {
      feed: 'binance',
      timestamps: ts,
      price_before: 65000,
      price_after: 65100,
      move_bps: 15.38,
    },
    config: {
      trigger_feed: 'binance',
      move_threshold_bps: 10,
      move_window_ms: 1000,
      max_response_ms: 5000,
    },
    btc_to_poly_ask_lag_ms: 420,
    btc_to_poly_bid_lag_ms: null,
    brti_to_poly_lag_ms: null,
    censored: false,
  };
  assert.equal(RepricingObservation.safeParse(obs).success, true);
});

test('Opportunity round-trips a full happy-path object', () => {
  const opp = {
    market: 'btc-1700000000',
    strike: 65000,
    side: 'YES',
    btc_price: 64800,
    seconds_remaining: 1800,
    distance_sigma: 0.42,
    volatility_regime: 'normal',
    target_velocity: 1.2,
    target_acceleration: -0.1,
    ofi: 0.3,
    obi: -0.1,
    microalpha: 0.0005,
    poly_bid: 0.38,
    poly_ask: 0.41,
    spread: 0.03,
    depth: 1200,
    fair_probability: 0.4,
    p_tp_05_60s: 0.21,
    p_tp_05_180s: 0.44,
    p_tp_10_60s: 0.08,
    p_tp_10_180s: 0.19,
    p_tp_before_stop: 0.57,
    expected_mfe: 0.06,
    expected_mae: -0.03,
    optimal_target: 0.05,
    optimal_horizon: 180,
    maker_fill_probability: 0.6,
    taker_fill_probability: 1,
    expected_net_ev: 3.1,
    ev_lower_confidence_bound: 0.4,
    cvar95: -8.5,
    recommended_entry: 0.39,
    recommended_size: 200,
    recommended_exit: 0.44,
    model_version: 'v001',
    scanned_at: 1_700_000_001_000,
  };
  const parsed = Opportunity.parse(opp);
  assert.equal(parsed.side, 'YES');
  // probability bounds enforced
  assert.equal(Opportunity.safeParse({ ...opp, fair_probability: 1.4 }).success, false);
});

test('RiskLimits requires positive staleness ceilings', () => {
  const ok = RiskLimits.safeParse({
    MAX_POSITION: 1000,
    MAX_STRIKE_EXPOSURE: 500,
    MAX_HOURLY_EXPOSURE: 2000,
    MAX_DAILY_LOSS: 250,
    MAX_OPEN_POSITIONS: 5,
    MAX_SPREAD: 0.05,
    MIN_DEPTH: 100,
    MAX_BINANCE_AGE: 1500,
    MAX_POLYMARKET_AGE: 2000,
    MAX_CLOCK_DRIFT: 250,
    MAX_ORDER_REJECTS: 3,
    MAX_UNKNOWN_ORDERS: 1,
    MAX_RECONNECT_RATE: 5,
  });
  assert.equal(ok.success, true);
});

test('OrderStatus enumerates UNKNOWN for the reconcile path', () => {
  assert.equal(OrderStatus.safeParse('UNKNOWN').success, true);
  assert.equal(OrderStatus.safeParse('MAYBE').success, false);
});

test('FEATURE_VERSION is exported and well-formed', () => {
  assert.match(FEATURE_VERSION, /^v\d{3,}$/);
  void ts;
});
