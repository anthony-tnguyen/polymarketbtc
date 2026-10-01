# @pmbtc/market-data

Phase 1 Recorder building blocks. Transport-injected so the venue protocol logic is fully deterministic and unit-tested without a network.

See **ASSUMPTIONS.md** for the venue semantics that bound replay fidelity (Binance update-id sync; Polymarket has no sequence number — integrity is best-bid/ask reconciliation against `price_change`, resyncing on the next `book` snapshot).

## Exports

- **ladder** — deterministic price→size `Ladder` (sorted on read; no iteration-order dependence).
- **binance** — `BinanceDepthBook`: REST-snapshot-anchored diff sync with `U`/`u` contiguity gap detection → `BTCState` (price = top-of-book mid).
- **polymarket** — `PolymarketBookState`: snapshot + delta with best-bid/ask reconciliation desync detection → `PolymarketBook` (records opaque `book_hash`; `sequence` always null).
- **feed-health** — `evaluateFeedHealth`: pure down/degraded/healthy classification backing the `feed_healthy` gate (I14).
- **unified-state** — `assembleUnifiedState`: merges `BTCState` + `PolymarketBook` into `UnifiedMarketState` with a freshness snapshot.
- **transport** — `Transport`/`TransportFactory` interfaces, `MockTransport(Factory)` for tests, `backoffDelay` reconnect policy.

## Not yet here (thin adapters, untestable in sandbox)

Real socket adapter (reconnect/backoff lifecycle), market discovery REST, rules parser, clock-sync estimator, and the Postgres/S3 sinks. Added and validated against live venues before any recorded data is trusted.
