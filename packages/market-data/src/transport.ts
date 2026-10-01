/**
 * Transport abstraction for websocket feeds. The venue protocol logic (parsing,
 * book maintenance, gap detection) is decoupled from the socket so it is fully
 * unit-testable: tests drive a {@link MockTransport}; production wires a real
 * socket adapter (reconnect/backoff live in the adapter, not the protocol).
 */
export interface TransportHandlers {
  onOpen(): void;
  onMessage(raw: string): void;
  onClose(reason?: string): void;
  onError(error: Error): void;
}

export interface Transport {
  /** Send a raw frame (e.g. a subscription request). */
  send(raw: string): void;
  /** Close the connection. */
  close(): void;
}

export interface TransportFactory {
  connect(url: string, handlers: TransportHandlers): Transport;
}

/** Reconnect/backoff policy for the real adapter. Documented here, applied there. */
export interface ReconnectPolicy {
  /** Base delay in ms. */
  baseMs: number;
  /** Max delay in ms (backoff cap). */
  maxMs: number;
  /** Multiplier per attempt (e.g. 2 for exponential). */
  factor: number;
}

export const DEFAULT_RECONNECT: ReconnectPolicy = { baseMs: 500, maxMs: 15_000, factor: 2 };

/** Backoff delay for attempt N (0-based), clamped to the policy max. */
export function backoffDelay(attempt: number, policy: ReconnectPolicy = DEFAULT_RECONNECT): number {
  const raw = policy.baseMs * policy.factor ** attempt;
  return Math.min(raw, policy.maxMs);
}

/**
 * In-memory transport for tests. Captures sent frames and exposes methods to
 * simulate the socket pushing messages / opening / closing / erroring.
 */
export class MockTransport implements Transport {
  readonly sent: string[] = [];
  closed = false;
  #handlers: TransportHandlers;

  constructor(handlers: TransportHandlers) {
    this.#handlers = handlers;
  }

  send(raw: string): void {
    this.sent.push(raw);
  }

  close(): void {
    this.closed = true;
    this.#handlers.onClose('closed by caller');
  }

  // ── test drivers ──────────────────────────────────────────────────────
  pushOpen(): void {
    this.#handlers.onOpen();
  }
  pushMessage(raw: string): void {
    this.#handlers.onMessage(raw);
  }
  pushClose(reason?: string): void {
    this.#handlers.onClose(reason);
  }
  pushError(error: Error): void {
    this.#handlers.onError(error);
  }
}

/** A factory that yields MockTransports and records them, for tests. */
export class MockTransportFactory implements TransportFactory {
  readonly created: MockTransport[] = [];
  connect(_url: string, handlers: TransportHandlers): Transport {
    const t = new MockTransport(handlers);
    this.created.push(t);
    return t;
  }
}
