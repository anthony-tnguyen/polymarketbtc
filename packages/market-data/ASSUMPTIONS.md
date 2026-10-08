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

**ASSUMPTION US-TS (timestamp).** `transactTime` is parsed **magnitude-aware**
(`parseVenueTimestamp` / `parseNumericTimestamp` in `timestamp.ts`): a numeric
value is classified as seconds (~1e9) / milliseconds (~1e12) / microseconds
(~1e15) / nanoseconds (~1e18) by magnitude, and ambiguous or implausible values
are **rejected** rather than assumed to be milliseconds. A non-numeric value is
parsed as ISO-8601. When absent/ambiguous/implausible, the local receive time is
used as the exchange-time fallback and a `timestamp_anomaly` is flagged (the two
timestamps stay distinct). **The real unit is still UNCONFIRMED — a live frame
will pin it down; the magnitude-aware parser is correct for whichever unit the
venue emits within the plausible window.**

**ASSUMPTION US-PX (price units).** `px.value` is parsed as dollars in `[0, 1]`
(e.g. "0.37" = 37¢); a price outside `[0,1]` (or a crossed book) is flagged
`impossible_prices` by the book core. If the DCM quotes in cents (0–100) instead,
divide by 100. **UNCONFIRMED — confirm against a live frame.**

### Contract identity (schema resolved; live representation UNCONFIRMED)

The venue-neutral identity on the recorder path is now **`market_slug` +
`outcome_id` + `direction` (UP/DOWN)**, not `token_ids {YES, NO}` (that scheme is
retained only for a possible future international/FIXED_STRIKE adapter). This is
the right shape for a reference Up/Down product. What a **live capture must still
confirm**: whether the two directions are two separate slugs or one book with the
complement implied, and the exact field that carries `marketSlug`/direction.

### Open questions — UNRESOLVED (egress to polymarket.us is blocked in this
environment; a live capture or docs.polymarket.us access is required):

1. **UP/DOWN vs YES/NO representation** and whether one slug is one directional
   book or outcomes are encoded another way.
2. **transactTime unit** (US-TS) and **price units** (US-PX) above.
3. Whether every `MarketData` message is a complete snapshot, or a separate
   incremental update type exists that the SDK does not surface.
4. The exact subscribe-frame envelope (`buildPolymarketUsSubscribeFrames` mirrors
   the SDK shape but is unconfirmed).
5. Fields that identify market state, close time, reference value, and
   settlement; minimum order size / tick behavior; any message variants not
   represented by the current schemas.

A transport-injected **capture utility** (`live/capture.ts`,
`PolymarketUsCapture`) and a real WebSocket adapter (`live/ws-transport.ts`) are
implemented and unit-tested against a mock transport; they persist every raw
frame verbatim with both timestamps (`RawEventRecord`) so these questions can be
answered the moment the feed is reachable. **Nothing here is marked confirmed
until a real capture validates it.**

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
