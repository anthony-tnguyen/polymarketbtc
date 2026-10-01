import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MarketId, TokenId } from '@pmbtc/contracts';
import {
  Ladder,
  BinanceDepthBook,
  BinanceDepthDiff,
  PolymarketBookState,
  PolymarketBookMessage,
  PolymarketPriceChangeMessage,
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

// ── Polymarket book: snapshot + reconciliation desync ───────────────────────
const MKT = 'btc-1700' as MarketId;
const TOK = 'tok-yes' as TokenId;

function snapshot(bids: [string, string][], asks: [string, string][]): PolymarketBookMessage {
  return PolymarketBookMessage.parse({
    event_type: 'book',
    asset_id: TOK,
    market: MKT,
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: '0xabc',
    timestamp: '1700000000000',
  });
}

function priceChange(
  changes: { price: string; size: string; side: 'BUY' | 'SELL'; best_bid?: string; best_ask?: string }[],
): PolymarketPriceChangeMessage {
  return PolymarketPriceChangeMessage.parse({
    event_type: 'price_change',
    market: MKT,
    timestamp: '1700000000500',
    price_changes: changes.map((c) => ({ asset_id: TOK, hash: '0xdef', ...c })),
  });
}

test('PolymarketBookState drops deltas until a snapshot arrives', () => {
  const s = new PolymarketBookState({ market_id: MKT, token_id: TOK, side: 'YES' });
  assert.equal(s.applyPriceChange(priceChange([{ price: '0.39', size: '5', side: 'BUY' }])).kind, 'dropped_unsynced');
  assert.equal(s.synced, false);
});

test('PolymarketBookState applies a reconciling delta', () => {
  const s = new PolymarketBookState({ market_id: MKT, token_id: TOK, side: 'YES' });
  s.applySnapshot(snapshot([['0.39', '10']], [['0.41', '8']]));
  // Improve the bid to 0.40; message says resulting best_bid=0.40, best_ask=0.41.
  const res = s.applyPriceChange(
    priceChange([{ price: '0.40', size: '6', side: 'BUY', best_bid: '0.40', best_ask: '0.41' }]),
  );
  assert.equal(res.kind, 'applied');
  const book = s.toBook(1_700_000_000_600);
  assert.equal(book.bids[0]!.price, 0.4);
  assert.equal(book.book_hash, '0xdef');
  assert.equal(book.sequence, null);
  assert.equal(book.gap_detected, false);
});

test('PolymarketBookState desyncs when top-of-book fails reconciliation', () => {
  const s = new PolymarketBookState({ market_id: MKT, token_id: TOK, side: 'YES' });
  s.applySnapshot(snapshot([['0.39', '10']], [['0.41', '8']]));
  // Apply a bid at 0.40 but claim best_bid should be 0.45 → local (0.40) != 0.45.
  const res = s.applyPriceChange(
    priceChange([{ price: '0.40', size: '6', side: 'BUY', best_bid: '0.45', best_ask: '0.41' }]),
  );
  assert.equal(res.kind, 'desync');
  assert.equal(s.synced, false);
  assert.equal(s.gapDetected, true);
  // A fresh snapshot resyncs.
  s.applySnapshot(snapshot([['0.42', '3']], [['0.44', '2']]));
  assert.equal(s.synced, true);
  assert.equal(s.gapDetected, false);
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
