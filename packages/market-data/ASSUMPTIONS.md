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
  `book` and `price_change`, but **its computation is unspecified**, so a client
  cannot recompute-and-verify it. We record the hash for audit but do not rely
  on recomputing it.
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
