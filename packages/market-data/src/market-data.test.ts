import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MarketId, TokenId } from '@pmbtc/contracts';
import {
  Ladder,
  BinanceDepthBook,
  BinanceDepthDiff,
  PolymarketUsBook,
  MarketDataMessage,
  parseTransactTime,
  evaluateFeedHealth,
  assembleUnifiedState,
  backoffDelay,
  DEFAULT_RECONNECT,
} from '@pmbtc/market-data';

// ── Ladder ────────────────────────────────────────────────────────────────
test('Ladder sorts deterministically regardless of insertion order', () => {
  const a = new Ladder();
  a.apply('bid', 0.4, 10);
  a.apply('bid', 0.38, 5);
  a.apply('bid', 0.39, 7);
  const b = new Ladder();
  b.apply('bid', 0.39, 7);
  b.apply('bid', 0.4, 10);
  b.apply('bid', 0.38, 5);
  assert.deepEqual(a.levels('bid'), b.levels('bid'));
  assert.deepEqual(a.levels('bid'), [
    { price: 0.4, size: 10 },
    { price: 0.39, size: 7 },
    { price: 0.38, size: 5 },
  ]);
  assert.equal(a.bestBid(), 0.4);
});

test('Ladder removes a level on size 0 and asks sort ascending', () => {
  const l = new Ladder();
  l.apply('ask', 0.42, 3);
  l.apply('ask', 0.41, 9);
  l.apply('ask', 0.42, 0); // remove
  assert.deepEqual(l.levels('ask'), [{ price: 0.41, size: 9 }]);
  assert.equal(l.bestAsk(), 0.41);
});

// ── Binance depth book: sync + gap detection ───────────────────────────────
function diff(U: number, u: number, bids: [string, string][], asks: [string, string][]): BinanceDepthDiff {
  return BinanceDepthDiff.parse({ e: 'depthUpdate', E: 1_700_000_000_000 + u, s: 'BTCUSDT', U, u, b: bids, a: asks });
}

test('BinanceDepthBook anchors to snapshot, discards stale, applies contiguous', () => {
  const book = new BinanceDepthBook('BTCUSDT');
  book.applyDiff(diff(100, 105, [['64990', '1']], [])); // stale vs snapshot (u<=110)
  book.applyDiff(diff(111, 115, [['64995', '2']], [['65010', '3']])); // straddles 110+1
  book.sync({ lastUpdateId: 110, bids: [['65000', '5']], asks: [['65005', '4']] });
  assert.equal(book.synced, true);
  const state = book.toBTCState(1_700_000_000_200);
  assert.ok(state);
  // best bid 65000 (snapshot) replaced? diff added 64995 bid (lower) + 65010 ask.
  assert.equal(state!.bid, 65000);
  assert.equal(state!.ask, 65005);
  assert.equal(state!.price, (65000 + 65005) / 2);
  assert.equal(state!.gap_detected, false);
});

test('BinanceDepthBook flags a gap on a non-contiguous update and clears book', () => {
  const book = new BinanceDepthBook('BTCUSDT');
  book.sync({ lastUpdateId: 200, bids: [['65000', '5']], asks: [['65005', '4']] });
  assert.equal(book.applyDiff(diff(201, 205, [], [])).kind, 'applied');
  const res = book.applyDiff(diff(210, 215, [], [])); // expected U=206
  assert.deepEqual(res, { kind: 'gap', expectedU: 206, gotU: 210 });
  assert.equal(book.synced, false);
  assert.equal(book.gapDetected, true);
  assert.equal(book.toBTCState(1_700_000_000_300), null); // not tradeable until resync
});

// ── Polymarket US book: full-snapshot-per-message ───────────────────────────
const MKT = 'btc-1700' as MarketId;
const TOK = 'tok-yes' as TokenId;

function marketData(
  bids: [string, string][],
  offers: [string, string][],
  opts: { state?: string; transactTime?: string } = {},
): MarketDataMessage {
  return MarketDataMessage.parse({
    requestId: 'r1',
    subscriptionType: 'SUBSCRIPTION_TYPE_MARKET_DATA',
    marketData: {
      marketSlug: 'btc-1700',
      bids: bids.map(([v, qty]) => ({ px: { value: v, currency: 'USD' }, qty })),
      offers: offers.map(([v, qty]) => ({ px: { value: v, currency: 'USD' }, qty })),
      state: opts.state ?? 'open',
      ...(opts.transactTime !== undefined ? { transactTime: opts.transactTime } : {}),
    },
  });
}

test('PolymarketUsBook has no data until a MarketData frame arrives', () => {
  const s = new PolymarketUsBook({ market_id: MKT, token_id: TOK, side: 'YES' });
  assert.equal(s.hasData, false);
});

test('PolymarketUsBook replaces the whole book on each snapshot', () => {
  const s = new PolymarketUsBook({ market_id: MKT, token_id: TOK, side: 'YES' });
  s.apply(marketData([['0.39', '10']], [['0.41', '8']], { transactTime: '1700000000000' }), 1_700_000_000_050);
  let book = s.toBook(1_700_000_000_060);
  assert.equal(book.bids[0]!.price, 0.39);
  assert.equal(book.asks[0]!.price, 0.41); // `offers` map to asks
  assert.equal(book.timestamps.exchange_timestamp, 1_700_000_000_000);
  assert.equal(book.sequence, null);
  assert.equal(book.book_hash, null);
  assert.equal(book.gap_detected, false);

  // A new snapshot fully replaces prior state (not merged).
  s.apply(marketData([['0.42', '3']], [['0.44', '2']], { state: 'open', transactTime: '1700000001000' }), 1_700_000_001_050);
  book = s.toBook(1_700_000_001_060);
  assert.deepEqual(book.bids, [{ price: 0.42, size: 3 }]);
  assert.deepEqual(book.asks, [{ price: 0.44, size: 2 }]);
  assert.equal(s.state, 'open');
});

test('PolymarketUsBook falls back to receive time when transactTime is absent', () => {
  const s = new PolymarketUsBook({ market_id: MKT, token_id: TOK, side: 'YES' });
  s.apply(marketData([['0.5', '1']], [['0.51', '1']]), 1_700_000_002_000);
  assert.equal(s.toBook(1_700_000_002_010).timestamps.exchange_timestamp, 1_700_000_002_000);
});

test('parseTransactTime handles epoch-ms strings, ISO, and junk', () => {
  assert.equal(parseTransactTime('1700000000000', 1), 1_700_000_000_000);
  assert.equal(parseTransactTime('2023-11-14T22:13:20.000Z', 1), Date.parse('2023-11-14T22:13:20.000Z'));
  assert.equal(parseTransactTime('', 42), 42);
  assert.equal(parseTransactTime(undefined, 42), 42);
  assert.equal(parseTransactTime('not-a-date', 42), 42);
});

// ── Feed health ─────────────────────────────────────────────────────────────
test('evaluateFeedHealth classifies down / degraded / healthy', () => {
  const base = {
    now: 10_000,
    reconnectCount: 0,
    clockDriftMs: 0,
    maxAgeMs: 1500,
    maxReconnectRate: 5,
    maxClockDriftMs: 250,
  } as const;

  const down = evaluateFeedHealth({ source: 'binance', lastExchangeTs: null, gapDetected: false, ...base });
  assert.equal(down.status, 'down');

  const stale = evaluateFeedHealth({ source: 'binance', lastExchangeTs: 8000, gapDetected: false, ...base });
  assert.equal(stale.status, 'degraded'); // age 2000 > 1500

  const gap = evaluateFeedHealth({ source: 'polymarket', lastExchangeTs: 9500, gapDetected: true, ...base });
  assert.equal(gap.status, 'degraded');

  const drift = evaluateFeedHealth({ source: 'clock', lastExchangeTs: 9500, gapDetected: false, ...base, clockDriftMs: 400 });
  assert.equal(drift.status, 'degraded');
  assert.equal(drift.clock_synced, false);

  const ok = evaluateFeedHealth({ source: 'binance', lastExchangeTs: 9500, gapDetected: false, ...base });
  assert.equal(ok.status, 'healthy');
  assert.equal(ok.age_ms, 500);
});

// ── Unified state ───────────────────────────────────────────────────────────
test('assembleUnifiedState computes freshness and tradeable', () => {
  const now = 1_700_000_010_000;
  const btc = {
    symbol: 'BTCUSDT',
    timestamps: { exchange_timestamp: now - 300, receive_timestamp: now - 290 },
    price: 65000,
    bid: 64999,
    ask: 65001,
    sequence: 10,
    gap_detected: false,
  };
  const book = {
    market_id: MKT,
    token_id: TOK,
    side: 'YES' as const,
    timestamps: { exchange_timestamp: now - 400, receive_timestamp: now - 390 },
    bids: [{ price: 0.4, size: 10 }],
    asks: [{ price: 0.41, size: 8 }],
    sequence: null,
    book_hash: '0x1',
    gap_detected: false,
  };
  const u = assembleUnifiedState({
    btc,
    book,
    now,
    closeTime: now + 600_000,
    maxBinanceAgeMs: 1500,
    maxPolymarketAgeMs: 2000,
  });
  assert.equal(u.btc_age_ms, 300);
  assert.equal(u.book_age_ms, 400);
  assert.equal(u.seconds_remaining, 600);
  assert.equal(u.tradeable, true);

  // A gapped book is not tradeable.
  const u2 = assembleUnifiedState({
    btc,
    book: { ...book, gap_detected: true },
    now,
    closeTime: now + 600_000,
    maxBinanceAgeMs: 1500,
    maxPolymarketAgeMs: 2000,
  });
  assert.equal(u2.tradeable, false);
});

// ── Backoff ───────────────────────────────────────────────────────────────
test('backoffDelay grows exponentially and clamps', () => {
  assert.equal(backoffDelay(0), 500);
  assert.equal(backoffDelay(1), 1000);
  assert.equal(backoffDelay(2), 2000);
  assert.equal(backoffDelay(10), DEFAULT_RECONNECT.maxMs); // clamped
});
