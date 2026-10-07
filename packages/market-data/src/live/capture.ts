import type { Clock } from '@pmbtc/core';
import type { RawEventRecord } from '@pmbtc/contracts';
import { MarketDataLiteMessage, MarketDataMessage, TradeMessage } from '../polymarket/messages.js';
import { parseVenueTimestamp } from '../timestamp.js';
import type { Transport, TransportFactory, TransportHandlers } from '../transport.js';

/**
 * Polymarket US raw-frame capture.
 *
 * Connects to the Markets WebSocket, subscribes to the requested channels, and
 * persists EVERY raw frame verbatim (append-only) with both timestamps — the
 * authoritative archive the recorder and replay are built on. The driver is
 * transport- and clock-injected so it is fully deterministic and unit-testable
 * against a MockTransport; only the real socket (ws-transport.ts) needs live
 * egress, which is not available in the build sandbox.
 *
 * The subscription-frame shape mirrors the SDK's request envelope; CONFIRM it
 * against a live session before trusting captured data (see ASSUMPTIONS.md).
 */

/** The three markets-channel subscription types we capture. */
export const CAPTURE_SUBSCRIPTION_TYPES = [
  'SUBSCRIPTION_TYPE_MARKET_DATA',
  'SUBSCRIPTION_TYPE_MARKET_DATA_LITE',
  'SUBSCRIPTION_TYPE_TRADE',
] as const;
export type CaptureSubscriptionType = (typeof CAPTURE_SUBSCRIPTION_TYPES)[number];

export interface PolymarketUsCaptureOptions {
  /** Market slugs to subscribe to. */
  marketSlugs: string[];
  /** Which subscription types to capture (defaults to all three). */
  subscriptionTypes?: readonly CaptureSubscriptionType[];
  /** Monotonic request-id source (injected for determinism). */
  nextRequestId?: () => string;
}

/** Sink for raw archival. Implementations persist append-only / write-once. */
export interface RawEventSink {
  write(record: RawEventRecord): void | Promise<void>;
}

/** In-memory sink for tests. */
export class InMemoryRawEventSink implements RawEventSink {
  readonly records: RawEventRecord[] = [];
  write(record: RawEventRecord): void {
    this.records.push(record);
  }
}

/**
 * Build one subscribe frame per subscription type. The envelope shape (type +
 * marketSlugs + requestId) mirrors the SDK; confirm against live before trust.
 */
export function buildPolymarketUsSubscribeFrames(opts: PolymarketUsCaptureOptions): string[] {
  const types = opts.subscriptionTypes ?? CAPTURE_SUBSCRIPTION_TYPES;
  const next = opts.nextRequestId ?? ((): string => 'sub');
  return types.map((subscriptionType) =>
    JSON.stringify({ requestId: next(), action: 'SUBSCRIBE', subscriptionType, marketSlugs: opts.marketSlugs }),
  );
}

/** Extract the channel, slug, and source timestamp from a parsed frame. */
function extractMeta(parsed: unknown): { channel: string; marketSlug: string | null; sourceTs: string | null } {
  const md = MarketDataMessage.safeParse(parsed);
  if (md.success) {
    return { channel: md.data.subscriptionType, marketSlug: md.data.marketData.marketSlug, sourceTs: md.data.marketData.transactTime ?? null };
  }
  const lite = MarketDataLiteMessage.safeParse(parsed);
  if (lite.success) {
    return { channel: lite.data.subscriptionType, marketSlug: lite.data.marketDataLite.marketSlug, sourceTs: null };
  }
  const trade = TradeMessage.safeParse(parsed);
  if (trade.success) {
    return { channel: trade.data.subscriptionType, marketSlug: trade.data.trade.marketSlug, sourceTs: trade.data.trade.tradeTime };
  }
  // A frame that validates against none of the known shapes: archive verbatim
  // with a best-effort channel label (the raw payload is still authoritative).
  const subType = (parsed as { subscriptionType?: unknown })?.subscriptionType;
  return { channel: typeof subType === 'string' ? subType : 'unrecognized', marketSlug: null, sourceTs: null };
}

/**
 * Drives capture over an injected transport. `start()` opens the connection;
 * on open it sends the subscribe frames; every inbound frame is archived
 * verbatim (even malformed ones — the raw archive is authoritative).
 */
export class PolymarketUsCapture {
  readonly #factory: TransportFactory;
  readonly #sink: RawEventSink;
  readonly #clock: Clock;
  readonly #url: string;
  readonly #opts: PolymarketUsCaptureOptions;
  #transport: Transport | null = null;

  constructor(args: {
    factory: TransportFactory;
    sink: RawEventSink;
    clock: Clock;
    url: string;
    options: PolymarketUsCaptureOptions;
  }) {
    this.#factory = args.factory;
    this.#sink = args.sink;
    this.#clock = args.clock;
    this.#url = args.url;
    this.#opts = args.options;
  }

  start(): void {
    const handlers: TransportHandlers = {
      onOpen: () => {
        for (const frame of buildPolymarketUsSubscribeFrames(this.#opts)) {
          this.#transport?.send(frame);
        }
      },
      onMessage: (raw) => this.#onMessage(raw),
      onClose: () => {},
      onError: () => {},
    };
    this.#transport = this.#factory.connect(this.#url, handlers);
  }

  stop(): void {
    this.#transport?.close();
    this.#transport = null;
  }

  #onMessage(raw: string): void {
    const receive = this.#clock.now();
    let channel = 'malformed';
    let marketSlug: string | null = null;
    let exchangeTs: number | null = null;
    let timestampAnomaly = true;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed JSON — still archive verbatim (raw authority). Leave anomaly.
      void this.#sink.write(this.#record(channel, marketSlug, receive, exchangeTs, true, raw));
      return;
    }

    const meta = extractMeta(parsed);
    channel = meta.channel;
    marketSlug = meta.marketSlug;
    const ts = parseVenueTimestamp(meta.sourceTs);
    if (ts.ok) {
      exchangeTs = ts.value.ms;
      timestampAnomaly = false;
    }
    void this.#sink.write(this.#record(channel, marketSlug, receive, exchangeTs, timestampAnomaly, raw));
  }

  #record(
    channel: string,
    marketSlug: string | null,
    receive: number,
    exchangeTs: number | null,
    timestampAnomaly: boolean,
    raw: string,
  ): RawEventRecord {
    return {
      venue: 'POLYMARKET_US',
      channel,
      market_slug: marketSlug,
      receive_timestamp: receive,
      exchange_timestamp: exchangeTs,
      timestamp_anomaly: timestampAnomaly,
      raw,
    };
  }
}
