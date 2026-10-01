import { z } from 'zod';
import {
  ClientOrderId,
  EpochMillis,
  IntentId,
  MarketId,
  OrderId,
  PositionId,
  Price01,
  Side,
  Size,
  TimestampPair,
  Usd,
  Version,
} from './common.js';

/**
 * A decision to open a trade. Produced only after an Opportunity clears all hard
 * gates and the EV_LCB > 0 check. It fully specifies the exit plan up front
 * (MATH_SPEC §Target/Horizon): entry, target, max_hold, state_stop, hard_stop,
 * size.
 */
export const TradeIntent = z.object({
  intent_id: IntentId,
  market_id: MarketId,
  side: Side,
  created_at: EpochMillis,

  /** Price we intend to enter at (executable). */
  entry: Price01,
  /** Profit-target exit price. */
  target: Price01,
  /** Time barrier: max seconds to hold before forced exit. */
  max_hold_seconds: z.number().positive(),
  /** State/model-deterioration exit threshold (price). */
  state_stop: Price01,
  /** Hard price-barrier stop. */
  hard_stop: Price01,
  /** Size after all hard caps (Invariant I7). */
  size: Size,

  /** The model version that justified this intent, for audit. */
  model_version: Version,
});
export type TradeIntent = z.infer<typeof TradeIntent>;

/** Maker rests on the book; taker crosses the spread (MATH_SPEC §Execution). */
export const ExecutionStyle = z.enum(['maker', 'taker']);
export type ExecutionStyle = z.infer<typeof ExecutionStyle>;

export const OrderPurpose = z.enum(['entry', 'exit']);
export type OrderPurpose = z.infer<typeof OrderPurpose>;

/**
 * A concrete order derived from a TradeIntent. `client_order_id` is our
 * idempotency key; at most one ACTIVE entry order may exist per intent_id
 * (Invariant I9).
 */
export const OrderIntent = z.object({
  intent_id: IntentId,
  client_order_id: ClientOrderId,
  market_id: MarketId,
  side: Side,
  purpose: OrderPurpose,
  style: ExecutionStyle,
  /** BUY to open the target-facing side; SELL to close. */
  action: z.enum(['BUY', 'SELL']),
  limit_price: Price01,
  size: Size,
  created_at: EpochMillis,
});
export type OrderIntent = z.infer<typeof OrderIntent>;

/**
 * Lifecycle status of an order. An order is only ever advanced on exchange
 * confirmation (Invariant I8). UNKNOWN triggers freeze + reconcile (I13).
 */
export const OrderStatus = z.enum([
  'PENDING_NEW', // created locally, not yet acknowledged by venue
  'OPEN', // acknowledged, resting/working
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'UNKNOWN', // state could not be confirmed — do not assume; reconcile
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Current state of an order as tracked by the execution state machine. */
export const OrderState = z.object({
  client_order_id: ClientOrderId,
  /** Venue-assigned id once acknowledged. */
  order_id: OrderId.nullable(),
  intent_id: IntentId,
  market_id: MarketId,
  side: Side,
  purpose: OrderPurpose,
  status: OrderStatus,
  limit_price: Price01,
  size: Size,
  /** Cumulative filled size and the size-weighted average fill price. */
  filled_size: Size,
  avg_fill_price: Price01.nullable(),
  timestamps: TimestampPair,
  /** Last update time, epoch millis. */
  updated_at: EpochMillis,
  /** Venue reason text on reject/cancel, for audit. */
  reason: z.string().optional(),
});
export type OrderState = z.infer<typeof OrderState>;

/** A confirmed (partial or full) fill. The only source of booked exposure. */
export const FillEvent = z.object({
  fill_id: z.string().min(1),
  order_id: OrderId,
  client_order_id: ClientOrderId,
  intent_id: IntentId,
  market_id: MarketId,
  side: Side,
  action: z.enum(['BUY', 'SELL']),
  price: Price01,
  size: Size,
  /** Fee paid on this fill in USD (positive = cost). */
  fee: Usd,
  /** Rebate received, reported separately — never counted as alpha (I11). */
  rebate: Usd.default(0),
  /** True if we were the resting (maker) side. */
  is_maker: z.boolean(),
  timestamps: TimestampPair,
});
export type FillEvent = z.infer<typeof FillEvent>;

export const PositionStatus = z.enum(['OPEN', 'CLOSING', 'CLOSED']);
export type PositionStatus = z.infer<typeof PositionStatus>;

/** Aggregated position for one trade intent, built from confirmed fills only. */
export const PositionState = z.object({
  position_id: PositionId,
  intent_id: IntentId,
  market_id: MarketId,
  side: Side,
  status: PositionStatus,
  /** Net size currently held. */
  size: Size,
  /** Size-weighted average entry price (executable). */
  entry_vwap: Price01,
  /** Best executable bid we could exit into right now, for the held size. */
  current_exit_vwap: Price01.nullable(),
  /** Realized and unrealized P&L in USD, executable basis (never midpoint). */
  realized_pnl: Usd,
  unrealized_pnl: Usd,
  opened_at: EpochMillis,
  updated_at: EpochMillis,
  closed_at: EpochMillis.nullable(),
});
export type PositionState = z.infer<typeof PositionState>;

/** Why an exit is being taken. */
export const ExitReason = z.enum([
  'target_hit', // profit target reached
  'state_stop', // state/model deterioration
  'hard_stop', // price barrier breached
  'max_hold', // time barrier reached
  'market_resolving', // hour is closing
  'risk_freeze', // risk engine forced flat
  'feed_degraded', // degraded-mode exit policy (I14)
]);
export type ExitReason = z.infer<typeof ExitReason>;

/** The exit engine's decision for an open position at a decision time. */
export const ExitDecision = z.object({
  position_id: PositionId,
  intent_id: IntentId,
  decided_at: EpochMillis,
  /** Whether to exit now. */
  exit_now: z.boolean(),
  reason: ExitReason.nullable(),
  style: ExecutionStyle.nullable(),
  /** Limit price for the exit order when exit_now is true. */
  limit_price: Price01.nullable(),
  /** Size to exit (may be partial). */
  size: Size,
  /** Model estimate of continuation value if we hold, for audit. */
  continuation_value: Usd.optional(),
});
export type ExitDecision = z.infer<typeof ExitDecision>;
