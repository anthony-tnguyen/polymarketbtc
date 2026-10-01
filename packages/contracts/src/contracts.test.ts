import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Opportunity,
  MarketDefinition,
  RiskLimits,
  OrderStatus,
  FEATURE_VERSION,
} from '@pmbtc/contracts';

const ts = { exchange_timestamp: 1_700_000_000_000, receive_timestamp: 1_700_000_000_050 };

test('MarketDefinition accepts a validated market and rejects a bad strike', () => {
  const base = {
    market_id: 'btc-1700000000',
    question: 'Will BTC be >= 65000 at 12:00 UTC?',
    underlying: 'BTCUSDT',
    strike: 65000,
    comparator: 'above',
    open_time: 1_700_000_000_000,
    close_time: 1_700_003_600_000,
    settlement_source: 'binance-spot-index',
    token_ids: { YES: 'tok-yes', NO: 'tok-no' },
    tick_size: 0.01,
    min_order_size: 5,
    rules_validated: true,
    rules_parser_version: 'v001',
    discovered_at: 1_699_999_000_000,
  };
  assert.equal(MarketDefinition.safeParse(base).success, true);
  assert.equal(MarketDefinition.safeParse({ ...base, strike: -1 }).success, false);
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
