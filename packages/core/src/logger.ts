import type { SystemEvent, SystemEventSeverity } from '@pmbtc/contracts';
import type { Clock } from './time.js';
import type { IdGenerator } from './ids.js';

/**
 * A sink for structured system events. The trader wires this to CloudWatch /
 * Postgres; tests use {@link CollectingEventSink} to assert on what was emitted.
 */
export interface EventSink {
  emit(event: SystemEvent): void;
}

/** What a caller supplies to record an event; ids/timestamps are filled in. */
export interface EventInput {
  severity: SystemEventSeverity;
  /** Stable machine code, e.g. "feed.gap", "order.unknown". */
  code: string;
  /** Component emitting the event, e.g. "market-data/polymarket-ws". */
  source: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Emits SystemEvents with consistent id + timestamp stamping. Time comes from an
 * injected Clock (so operational timestamps are controllable in tests) and ids
 * from an injected IdGenerator.
 */
export class SystemEventLogger {
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #sink: EventSink;

  constructor(clock: Clock, ids: IdGenerator, sink: EventSink) {
    this.#clock = clock;
    this.#ids = ids;
    this.#sink = sink;
  }

  log(input: EventInput): SystemEvent {
    const event: SystemEvent = {
      event_id: this.#ids.next('evt'),
      occurred_at: this.#clock.now(),
      severity: input.severity,
      code: input.code,
      source: input.source,
      message: input.message,
      ...(input.context !== undefined ? { context: input.context } : {}),
    };
    this.#sink.emit(event);
    return event;
  }

  info(source: string, code: string, message: string, context?: Record<string, unknown>) {
    return this.log({ severity: 'info', source, code, message, ...(context ? { context } : {}) });
  }
  warn(source: string, code: string, message: string, context?: Record<string, unknown>) {
    return this.log({ severity: 'warn', source, code, message, ...(context ? { context } : {}) });
  }
  error(source: string, code: string, message: string, context?: Record<string, unknown>) {
    return this.log({ severity: 'error', source, code, message, ...(context ? { context } : {}) });
  }
  critical(source: string, code: string, message: string, context?: Record<string, unknown>) {
    return this.log({ severity: 'critical', source, code, message, ...(context ? { context } : {}) });
  }
}

/** Writes events to the console as single-line JSON. For dev/edge use. */
export class ConsoleEventSink implements EventSink {
  emit(event: SystemEvent): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(event));
  }
}

/** Buffers emitted events in memory. For tests and local assertions. */
export class CollectingEventSink implements EventSink {
  readonly events: SystemEvent[] = [];
  emit(event: SystemEvent): void {
    this.events.push(event);
  }
}
