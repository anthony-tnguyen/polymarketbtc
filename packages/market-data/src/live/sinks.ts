import { appendFileSync } from 'node:fs';
import type { RawEventRecord } from '@pmbtc/contracts';
import type { RawEventSink } from './capture.js';

/**
 * Raw-archive sinks.
 *
 * The production raw archive is S3 (append-only, write-once) and derived
 * operational state is PostgreSQL (ARCHITECTURE §7, AGENTS §4). Both are AWS
 * adapters that implement {@link RawEventSink} (and, for derived state, a
 * separate derived-state sink) and are wired in `apps/trader` / infra; they
 * cannot be exercised in the build sandbox, so only the local dev sink below is
 * shipped here. The S3/Postgres adapters MUST preserve both timestamps and treat
 * the raw stream as authoritative and immutable.
 */

/**
 * Local newline-delimited-JSON sink for development/replay fixtures. Appends one
 * {@link RawEventRecord} per line. Edge I/O — not on the deterministic model
 * path. Not for production (use the S3 adapter there).
 */
export class NdjsonFileSink implements RawEventSink {
  readonly #path: string;
  constructor(path: string) {
    this.#path = path;
  }
  write(record: RawEventRecord): void {
    appendFileSync(this.#path, JSON.stringify(record) + '\n');
  }
}
