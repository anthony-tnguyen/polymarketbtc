# market-data — venue & recording assumptions

Per `AGENTS.md` §9, every subsystem documents its assumptions. These are the
ones that bound the fidelity of everything downstream (replay, labels, backtest),
so they are written down explicitly and revisited against live captures.

Sources: Polymarket US SDK (`Polymarket/polymarket-us-typescript`,
`src/websocket/types.ts`, `src/types/common.ts`) and docs.polymarket.us; Binance
spot market-streams docs. (International-venue sources are cited in the historical
note at the end.)

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

## Polymarket US (the venue we trade) — confirmed 2026-10-01

**Target venue is Polymarket US** (polymarket.us), the CFTC-regulated DCM/DCO
operated by QCX LLC — NOT the international on-chain CLOB (polymarket.com). They
are separate venues with separate stacks; the choice is recorded here because it
determines the entire ingestion layer. (US persons are close-only on the
international venue, so it is not a trading target for us.)

Market data comes from the **Markets WebSocket**
(`wss://api.polymarket.us/v1/ws/markets`). Subscriptions:
`SUBSCRIPTION_TYPE_MARKET_DATA` (full book + stats), `..._MARKET_DATA_LITE`
(best bid/ask only), `..._TRADE`. Shapes mirror the official SDK
(`Polymarket/polymarket-us-typescript`, `src/websocket/types.ts`).

- **Full snapshot per message.** A `MarketData` frame carries the COMPLETE book
  every time (`bids` + `offers`, each `{ px: Amount, qty }`). There are **no
  deltas, no `hash`, and no sequence number** on the WS path. Book maintenance is
  therefore "replace the ladder each message" (`PolymarketUsBook.apply`); there
  is no delta-desync concept, so the hash saga and the old reconciliation
  workarounds (prior P1–P4) are **retired for this venue**.
- **Sequence numbers live on the FIX gateway**, not the WS feed. If we later need
  sequenced, gap-recoverable market data (institutional), that is the FIX
  market-data gateway (session-scoped seq nums, `ResetSeqNumFlag`), a separate
  adapter. For the recorder we use the WS feed.
- `Amount` is `{ value: string, currency: "USD" }`; `offers` are the ask side.
- Integrity reduces to **staleness + disconnect** detection (feed-health layer),
  since every message is a fresh full book.

**ASSUMPTION US-TS (timestamp).** `transactTime` is a string; a purely-numeric
value is treated as epoch milliseconds, otherwise as ISO-8601
(`parseTransactTime`). When absent, the local receive time is used as the
exchange-time fallback (the two timestamps stay distinct). **Confirm the real
unit against a live frame before trusting recorded times.**

**ASSUMPTION US-PX (price units).** `px.value` is parsed as dollars in `[0, 1]`
(e.g. "0.37" = 37¢). If the DCM quotes in cents (0–100) instead, divide by 100.
**Confirm against a live frame.**

### Open questions (need docs.polymarket.us access — egress-blocked here — or a
live capture):

1. **Binary market identity.** The WS identifies a contract by `marketSlug` and
   exposes one `bids`/`offers` book. How are YES vs NO represented — two slugs,
   or one book priced for YES with NO as the complement? This decides whether
   `MarketDefinition.token_ids {YES, NO}` is the right contract shape or should
   become slug-based. Deferred deliberately; the book core takes identity as a
   parameter so it is unaffected either way.
2. **transactTime unit** (US-TS) and **price units** (US-PX) above.
3. Whether `MarketData` is truly snapshot-only or whether a separate incremental
   update type exists that the SDK does not surface.

### Historical note — international hash investigation

An earlier pass targeted the international CLOB and chased whether its market-
channel `hash` could verify book integrity. Conclusion was no: the algorithm
(`SHA1_hex(JSON.stringify(orderbook))`, hash field blanked) is published in
`Polymarket/clob-client`, but the exact `OrderBookSummary` field order/extra
fields can't be reconstructed from a WS frame, and independent implementers
couldn't match the server on live data (py-clob-client#209, archived; rs-clob-
client#225, open). That venue is not our target, so the finding is retained only
as context for why we do not pursue hash-based integrity.

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
