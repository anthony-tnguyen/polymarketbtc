/**
 * @pmbtc/market-data — Phase 1 Recorder building blocks.
 *
 * This package currently exports the transport-injected, fully-deterministic
 * protocol core: order-book maintenance + gap detection for both venues, the
 * feed-health monitor, and the unified state engine. The live socket adapter
 * and the DB/S3 sinks are thin wrappers added once validated against the real
 * venues (see ASSUMPTIONS.md).
 */
export * from './ladder.js';
export * from './transport.js';
export * from './feed-health.js';
export * from './unified-state.js';

export * from './binance/messages.js';
export * from './binance/book.js';

export * from './polymarket/messages.js';
export * from './polymarket/book.js';
