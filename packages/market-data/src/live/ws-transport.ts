import {
  backoffDelay,
  DEFAULT_RECONNECT,
  type ReconnectPolicy,
  type Transport,
  type TransportFactory,
  type TransportHandlers,
} from '../transport.js';

/**
 * Real WebSocket transport for the live feeds. This is EDGE code: it owns the
 * socket lifecycle (connect, reconnect with exponential backoff) and nothing
 * else — all venue protocol logic (parsing, book maintenance, integrity) lives
 * in the transport-injected cores so it stays deterministic and unit-tested.
 *
 * It cannot be exercised in the build sandbox (outbound egress to the venues is
 * blocked), so it is intentionally thin: the only logic here is reconnect/backoff
 * and shuttling bytes to the injected {@link TransportHandlers}. Validate against
 * the live venue before trusting any recorded data (ASSUMPTIONS.md).
 *
 * Uses the Node ≥ 22 global `WebSocket`. A minimal structural type is declared so
 * this compiles without the DOM lib; the runtime object provides these members.
 */

interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (ev: { reason?: string }) => void): void;
  addEventListener(type: 'error', listener: (ev: unknown) => void): void;
}
type WebSocketCtor = new (url: string) => MinimalWebSocket;

function getWebSocketCtor(): WebSocketCtor {
  const ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!ctor) {
    throw new Error('global WebSocket is unavailable (Node >= 22 required for the live transport)');
  }
  return ctor;
}

/** A single live WebSocket connection bound to a set of handlers. */
class WsTransport implements Transport {
  readonly #ws: MinimalWebSocket;
  constructor(url: string, handlers: TransportHandlers) {
    const Ctor = getWebSocketCtor();
    this.#ws = new Ctor(url);
    this.#ws.addEventListener('open', () => handlers.onOpen());
    this.#ws.addEventListener('message', (ev) => handlers.onMessage(String((ev as { data: unknown }).data)));
    this.#ws.addEventListener('close', (ev) => handlers.onClose((ev as { reason?: string }).reason));
    this.#ws.addEventListener('error', () => handlers.onError(new Error('websocket error')));
  }
  send(raw: string): void {
    this.#ws.send(raw);
  }
  close(): void {
    this.#ws.close();
  }
}

/**
 * Factory that connects real WebSockets and reconnects on close/error with
 * exponential backoff (policy-driven; the same backoff math unit-tested via
 * {@link backoffDelay}). The caller's `onOpen` re-subscribes on every (re)connect,
 * so a reconnect re-primes the feed; the snapshot-per-message US book needs no
 * replay on reconnect.
 */
export class WsTransportFactory implements TransportFactory {
  readonly #policy: ReconnectPolicy;
  readonly #setTimeout: (fn: () => void, ms: number) => void;

  constructor(opts: { policy?: ReconnectPolicy; setTimeoutFn?: (fn: () => void, ms: number) => void } = {}) {
    this.#policy = opts.policy ?? DEFAULT_RECONNECT;
    this.#setTimeout = opts.setTimeoutFn ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  connect(url: string, handlers: TransportHandlers): Transport {
    let attempt = 0;
    let closedByCaller = false;
    let current: WsTransport;

    const wrapped: TransportHandlers = {
      onOpen: () => {
        attempt = 0; // reset backoff on a healthy connection
        handlers.onOpen();
      },
      onMessage: handlers.onMessage,
      onClose: (reason) => {
        handlers.onClose(reason);
        if (!closedByCaller) scheduleReconnect();
      },
      onError: (error) => {
        handlers.onError(error);
      },
    };

    const scheduleReconnect = (): void => {
      const delay = backoffDelay(attempt++, this.#policy);
      this.#setTimeout(() => {
        if (!closedByCaller) current = new WsTransport(url, wrapped);
      }, delay);
    };

    current = new WsTransport(url, wrapped);

    return {
      send: (raw) => current.send(raw),
      close: () => {
        closedByCaller = true;
        current.close();
      },
    };
  }
}
