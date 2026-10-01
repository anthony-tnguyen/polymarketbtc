/**
 * Typed errors with a stable, machine-readable `code` so they can be matched,
 * counted, and surfaced as SystemEvents without string-sniffing messages.
 */

/** Stable error codes. Keep these aligned with SystemEvent `code` conventions. */
export const ErrorCode = {
  // ingestion / feeds
  FEED_STALE: 'feed.stale',
  FEED_GAP: 'feed.gap',
  FEED_DISCONNECTED: 'feed.disconnected',
  CLOCK_DRIFT: 'clock.drift',
  // market discovery / rules
  RULES_UNVALIDATED: 'rules.unvalidated',
  RULES_PARSE_FAILED: 'rules.parse_failed',
  // orders / execution
  ORDER_REJECTED: 'order.rejected',
  ORDER_UNKNOWN: 'order.unknown',
  ORDER_DUPLICATE_ENTRY: 'order.duplicate_entry',
  // risk
  RISK_LIMIT_BREACHED: 'risk.limit_breached',
  RISK_FROZEN: 'risk.frozen',
  // model / schema
  MODEL_UNSUPPORTED: 'model.unsupported',
  SCHEMA_INVALID: 'schema.invalid',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Base application error carrying a stable code and optional structured context. */
export class AppError extends Error {
  readonly code: string;
  readonly context: Readonly<Record<string, unknown>> | undefined;

  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
  }
}

/** An invariant was violated. These are never "worked around" — they escalate. */
export class InvariantViolation extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('invariant.violation', message, context);
    this.name = 'InvariantViolation';
  }
}
