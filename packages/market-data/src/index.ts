/**
 * @pmbtc/market-data — Phase 1 Recorder building blocks.
 *
 * Target venue is Polymarket US (wss://api.polymarket.us). This package exports
 * the transport-injected, fully-deterministic protocol core: Binance depth-book
 * maintenance with update-id gap detection, the Polymarket US snapshot-per-
 * message book core, the feed-health monitor, and the unified state engine. The
 * live socket adapter and the DB/S3 sinks are thin wrappers added once validated
 * against the real venues (see ASSUMPTIONS.md).
 */
export * from './ladder.js';
export * from './transport.js';
export * from './feed-health.js';
export * from './unified-state.js';
export * from './clock-sync.js';
export * from './rules.js';

export * from './binance/messages.js';
export * from './binance/book.js';

export * from './polymarket/messages.js';
export * from './polymarket/book.js';
