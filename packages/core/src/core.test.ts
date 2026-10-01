import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ManualClock,
  SystemClock,
  ageMs,
  isStale,
  MS,
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  unwrap,
  unwrapOr,
  AppError,
  InvariantViolation,
  ErrorCode,
  DeterministicIdGenerator,
  RandomIdGenerator,
  SystemEventLogger,
  CollectingEventSink,
} from '@pmbtc/core';

test('ManualClock moves forward, never backward', () => {
  const c = new ManualClock(1000);
  assert.equal(c.now(), 1000);
  c.advance(500);
  assert.equal(c.now(), 1500);
  c.set(2000);
  assert.equal(c.now(), 2000);
  assert.throws(() => c.set(1999), /cannot move backwards/);
  assert.throws(() => c.advance(-1), /negative delta/);
});

test('SystemClock returns a plausible wall-clock time', () => {
  const t = new SystemClock().now();
  assert.ok(t > 1_600_000_000_000, 'should be well after 2020');
});

test('ageMs clamps at 0 and isStale uses the ceiling', () => {
  assert.equal(ageMs(1000, 1000), 0);
  assert.equal(ageMs(1000, 1200), 0); // future event -> clamp, not negative
  assert.equal(ageMs(2500, 1000), 1500);
  assert.equal(isStale(2500, 1000, MS.second), true); // 1500ms > 1000ms
  assert.equal(isStale(1800, 1000, MS.second), false); // 800ms <= 1000ms
});

test('Result helpers compose', () => {
  const good = ok(2);
  const bad = err(new AppError(ErrorCode.SCHEMA_INVALID, 'nope'));
  assert.equal(isOk(good), true);
  assert.equal(isErr(bad), true);
  assert.deepEqual(map(good, (n) => n * 10), ok(20));
  assert.equal(unwrap(map(good, (n) => n + 1)), 3);
  assert.equal(unwrapOr(bad, 99), 99);
  assert.equal(isOk(map(bad, (n: number) => n)), false); // error passes through
  const remapped = mapErr(bad, (e) => e.code);
  assert.equal(isErr(remapped) && remapped.error, ErrorCode.SCHEMA_INVALID);
  assert.throws(() => unwrap(bad), /nope/);
});

test('InvariantViolation carries a stable code', () => {
  const e = new InvariantViolation('stale feed priced an order', { feed: 'binance' });
  assert.equal(e.code, 'invariant.violation');
  assert.equal(e.context?.feed, 'binance');
  assert.ok(e instanceof AppError);
});

test('DeterministicIdGenerator is reproducible across runs', () => {
  const a = new DeterministicIdGenerator('seed');
  const b = new DeterministicIdGenerator('seed');
  const seqA = [a.next('intent'), a.next('intent'), a.next('order')];
  const seqB = [b.next('intent'), b.next('intent'), b.next('order')];
  assert.deepEqual(seqA, seqB, 'same seed + call order => identical ids');
  assert.notEqual(seqA[0], seqA[1], 'ids are unique within a generator');
});

test('RandomIdGenerator produces unique, prefixed ids', () => {
  const g = new RandomIdGenerator();
  const x = g.next('evt');
  const y = g.next('evt');
  assert.match(x, /^evt_/);
  assert.notEqual(x, y);
});

test('SystemEventLogger stamps ids + injected time deterministically', () => {
  const clock = new ManualClock(1_700_000_000_000);
  const ids = new DeterministicIdGenerator('t');
  const sink = new CollectingEventSink();
  const log = new SystemEventLogger(clock, ids, sink);

  log.warn('market-data/polymarket-ws', ErrorCode.FEED_GAP, 'sequence gap', { expected: 5, got: 7 });
  clock.advance(MS.second);
  log.critical('risk', ErrorCode.RISK_FROZEN, 'entries frozen');

  assert.equal(sink.events.length, 2);
  const [first, second] = sink.events;
  assert.equal(first!.occurred_at, 1_700_000_000_000);
  assert.equal(first!.severity, 'warn');
  assert.equal(first!.code, 'feed.gap');
  assert.equal(first!.context?.got, 7);
  assert.equal(second!.occurred_at, 1_700_000_001_000);
  assert.notEqual(first!.event_id, second!.event_id);
  // No `context` key when none supplied (exactOptionalPropertyTypes).
  assert.equal('context' in second!, false);
});
