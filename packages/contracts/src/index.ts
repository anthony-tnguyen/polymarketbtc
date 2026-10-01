/**
 * @pmbtc/contracts — the single source of truth for every shape that crosses a
 * package, process, database, or S3 boundary.
 *
 * Every schema is a Zod schema; the TypeScript type is INFERRED from it
 * (`z.infer`), never hand-written in parallel. Import types and schemas from
 * here; never redefine a contract elsewhere.
 */
export * from './common.js';
export * from './market.js';
export * from './btc.js';
export * from './book.js';
export * from './state.js';
export * from './features.js';
export * from './model.js';
export * from './opportunity.js';
export * from './trade.js';
export * from './risk.js';
export * from './health.js';
