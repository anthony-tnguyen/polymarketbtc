# @pmbtc/market-data

Phase 1 Recorder building blocks. Transport-injected so the venue protocol logic is fully deterministic and unit-tested without a network.

**Target venue: Polymarket US** (`wss://api.polymarket.us/v1/ws/markets`). See **ASSUMPTIONS.md** for the venue semantics that bound replay fidelity, the confirmed US message schema, and the open questions still needing a live capture.

## Exports

- **ladder** — deterministic price->size `Ladder` (sorted on read; no iteration-order dependence).
- **binance** — `BinanceDepthBook`: REST-snapshot-anchored diff sync with `U`/`u` contiguity gap detection -> `BTCState` (price = top-of-book mid).
- **polymarket** — `PolymarketUsBook`: full-snapshot-per-message book core (US Markets WebSocket sends the complete book every frame; no deltas/hash/sequence) -> `PolymarketBook`. `parseTransactTime` + `MarketData`/`MarketDataLite`/`Trade` zod schemas.
- **feed-health** — `evaluateFeedHealth`: pure down/degraded/healthy classification backing the `feed_healthy` gate (I14). For the US WS feed, integrity is staleness + disconnect (no per-message desync).
- **unified-state** — `assembleUnifiedState`: merges `BTCState` + `PolymarketBook` into `UnifiedMarketState` with a freshness snapshot.
- **transport** — `Transport`/`TransportFactory` interfaces, `MockTransport(Factory)` for tests, `backoffDelay` reconnect policy.

## Not yet here (thin adapters, untestable in sandbox)

Real socket adapter (reconnect/backoff lifecycle), the FIX market-data gateway (if sequenced data is later needed), market discovery, rules parser, clock-sync estimator, and the Postgres/S3 sinks. Added and validated against live venues before any recorded data is trusted.
