# market-data — venue & recording assumptions

Per `AGENTS.md` §9, every subsystem documents its assumptions. These are the
ones that bound the fidelity of everything downstream (replay, labels, backtest),
so they are written down explicitly and revisited against live captures.

Sources: Polymarket real-time-data / CLOB websocket docs and the
`Polymarket/agent-skills` reference; Binance spot market-streams docs.

---

## Binance (BTC driver)

We drive BTC state from the **diff depth stream** (`<symbol>@depth@100ms`)
anchored to a REST order-book snapshot, because it gives us *real* sequencing.

- Each diff event carries `U` (first update id) and `u` (final update id) and a
  `pu`-style contiguity expectation: the next event's `U` must equal the
  previous event's `u + 1`. A break is a **gap**.
- Sync algorithm (as documented by Binance, implemented in `binance/book.ts`):
  1. Buffer diffs. Fetch a REST snapshot with its `lastUpdateId`.
  2. Discard any buffered diff with `u <= lastUpdateId`.
  3. The first applied diff must satisfy `U <= lastUpdateId + 1 <= u`.
  4. Thereafter each event must be contiguous (`U == prev_u + 1`); otherwise
     drop the local book and re-snapshot.
- `E` is the event time in **milliseconds** → `exchange_timestamp`.
- We derive BTC `price` as the **mid of top-of-book** (best bid/ask), with
  `bid`/`ask` recorded too. (Mid is a low-noise driver and avoids a second
  stream; revisit if the model wants last-trade instead.)

**ASSUMPTION B1.** Update-id contiguity (`U == prev_u + 1`) holds on the spot
diff stream. If a venue change breaks this, gap detection over-fires (safe:
triggers a re-snapshot) rather than silently corrupting the book.

## Polymarket (the market we trade)

Market channel (`wss://ws-subscriptions-clob.polymarket.com/ws/market`), no auth.

Message types observed: `book`, `price_change`, `last_trade_price`,
`tick_size_change`, `best_bid_ask`, `new_market`, `market_resolved`.

- **No sequence number exists on this channel.** There is a `hash` field on
  `book` and `price_change`. The algorithm is published in Polymarket's own TS
  client but is **not practically usable for live integrity verification** — see
  "Hash investigation" below. We record the hash for audit and do **not** gate on
  recomputing it.
- `book` is a **full snapshot** (bids/asks ladders). It arrives on subscribe and
  after trades. It is our source of truth / resync point.
- `price_change` is a **delta**; `size == "0"` removes that price level. It also
  carries `best_bid` / `best_ask` of the resulting book.
- `timestamp` is a **string of epoch milliseconds** → `exchange_timestamp`.

**ASSUMPTION P1 (integrity check).** Because there is no sequence number and the
hash is opaque, we detect desync by reconciliation: after applying a
`price_change` to the local ladder, our recomputed best bid/ask must equal the
message's `best_bid`/`best_ask`. On mismatch we mark the book out-of-sync
(`gap_detected = true`), discard local ladder state, and wait for the next
`book` snapshot to resync. This is strictly conservative — a false desync costs
us one snapshot wait, never a corrupted book.

**ASSUMPTION P2.** A `book` snapshot fully replaces local state (we do not try
to merge it). `market_resolved` ends the market; no further trading.

**ASSUMPTION P3.** `best_bid`/`best_ask` in a `price_change` are present and
authoritative when the field is non-null. When null (thin/empty side), we skip
the reconciliation check for that side rather than forcing a desync.

**ASSUMPTION P4 (deep-ladder mitigation — REQUIRED before trusting data).** P1's
best-bid/ask reconciliation catches top-of-book drift but is blind to a dropped
delta deep in the ladder that does not move the touch. Our features read OBI/OFI
at 5–10 levels, so deep-ladder corruption matters. Because the venue hash cannot
be verified (below), the socket adapter / recorder loop MUST force a periodic
full resubscribe → fresh `book` snapshot on a bounded cadence (`maxSyncAgeMs`,
and immediately on any desync) so deep-ladder drift cannot accumulate unbounded
between the `book` snapshots the venue sends on its own. This belongs to the
(deferred) adapter layer; `PolymarketBookState.applySnapshot` is already the
idempotent resync primitive it will call.

## Hash investigation (2026-10-01)

Question chased: can we reproduce Polymarket's order-book `hash` client-side and
use it as an integrity check? **Conclusion: no — treat the hash as
non-authoritative.** Evidence:

- The algorithm is published: `hash = SHA1_hex(JSON.stringify(orderbook))` with
  the `hash` field set to `""` before serialization, in
  `Polymarket/clob-client` `src/utilities.ts` (`generateOrderBookSummaryHash`).
- But the serialized `OrderBookSummary` (`src/types.ts`) is
  `{ market, asset_id, timestamp, bids, asks, min_order_size, tick_size,
  neg_risk, last_trade_price, hash }` — `hash` is **last**, and four fields
  (`min_order_size`, `tick_size`, `neg_risk`, `last_trade_price`) are included.
  `JSON.stringify` emits in declaration order, so any other field order fails.
- The WS market-channel `book`/`price_change` frames do **not** carry those four
  fields in the same shape, so the exact hashed object cannot be losslessly
  reconstructed from a websocket frame.
- Independent implementers report the computation matches the TS *test vectors*
  but **not real backend messages**, with no documented root cause
  (py-clob-client issue #209 — now **archived/read-only** as of 2026-05-25;
  rs-clob-client issue #225 — open, unanswered).

Decision: keep recording `book_hash` for audit; integrity stays on P1 + P4. If
Polymarket later documents a byte-exact, WS-reconstructable hash (or exposes a
sequence number), revisit and add recompute-verify as a cheap extra gate.

Sources: `Polymarket/clob-client` src/utilities.ts & src/types.ts;
py-clob-client#209; rs-clob-client#225; Polymarket/agent-skills websocket.md.

## Recording

- Every raw frame is archived verbatim to S3 (append-only, write-once) with both
  `receive_timestamp` (local, from `SystemClock` at the edge) and the venue
  `exchange_timestamp` parsed from the frame. We never collapse the two (I5/I6).
- Derived state (BTCState, PolymarketBook, UnifiedMarketState, FeedHealth,
  SystemEvent) is persisted to Postgres. Replay fidelity is bounded by the raw
  archive, so the archive is the authority; derived tables are reproducible from
  it.

## What is NOT asserted here

- The real socket lifecycle (reconnect/backoff) and the AWS S3/Postgres writers
  are thin adapters that cannot be exercised in the build sandbox; they are kept
  behind the `Transport` / sink interfaces so the protocol logic above is fully
  unit-tested, and the adapters are validated against the live venues before any
  recorded data is trusted.
