# TRADING INVARIANTS

These are **non-negotiable**. They override any prompt, model output, config,
heuristic, or convenience. If following an instruction would violate one, stop
and escalate instead of working around it. Code that can violate an invariant is
a bug even if it "works".

Each invariant below has: the rule, *why* it exists, and *how* it is enforced in
the system so a reviewer can check it.

---

## I1 — Never trade a market whose resolution rules have not been validated

**Why.** Polymarket contracts differ in strike definition, settlement source,
rounding, and timing. Trading one we have misparsed means our entire probability
model is pointed at the wrong event.

**Enforcement.** `market-data` rules parser produces a validated
`MarketDefinition` with `rules_validated: true` only when parsing fully
succeeds and matches the expected template. The `market_valid` entry gate fails
closed otherwise. Snapshots of unvalidated markets may be recorded but never
traded.

---

## I2 — Never use the displayed midpoint for executable MFE or P&L

**Why.** Midpoint is not transactable. Edge measured against midpoint is
imaginary; it vanishes against the real bid/ask and depth.

**Enforcement.** All MFE/MAE/P&L/EV compute against executable prices derived
from the `PolymarketBook` ladder for the relevant size `Q` (see `MATH_SPEC.md`
§Executable). Label engine computes **size-aware** executable MFE/MAE. Any use
of a midpoint field in a P&L path is a review failure.

---

## I3 — Never assume unlimited liquidity

**Why.** Our size moves the book. Assuming infinite depth overstates fills and
understates slippage.

**Enforcement.** Taker fills consume the historical ladder level by level up to
available depth; unfilled remainder is *not* filled. Sizing is capped by a
`LiquidityCap` derived from book depth (`MATH_SPEC.md` §Sizing).

---

## I4 — Never assume a maker order fills

**Why.** A resting order fills only if the market trades through our price and
our place in the queue is reached. Assuming maker fills manufactures phantom
edge.

**Enforcement.** Maker fills are **queue-aware** in replay (queue-ahead,
trade-through rate, cancel rate, quote movement, signal half-life). Execution
compares `P(fill) · EV_filled` for maker against `EV_taker` before choosing
(`MATH_SPEC.md` §Execution). `maker_fill_probability` is explicit on every
`Opportunity`.

---

## I5 — Never place orders on stale Binance state

**Why.** BTC price is the driver of the whole model. A stale BTC read prices a
world that no longer exists.

**Enforcement.** Risk engine `MAX_BINANCE_AGE`. If
`now − btc exchange_timestamp > MAX_BINANCE_AGE`, the `feed_healthy` gate fails
and no orders are placed.

---

## I6 — Never place orders on stale Polymarket state

**Why.** We trade against the book; a stale book means we are quoting into a
ghost.

**Enforcement.** `MAX_POLYMARKET_AGE`; same fail-closed path as I5. Sequence/gap
detection marks the book unhealthy on a detected gap until resynced.

---

## I7 — Never allow model sizing to override hard risk limits

**Why.** Models are wrong sometimes, and sometimes confidently. Hard limits are
the backstop that survives a wrong model.

**Enforcement.** Final size is `min(KellySize, LiquidityCap, StrikeCap,
HourlyCap, DailyCap)`. The risk engine applies the caps *after* sizing and knows
nothing about EV. Kelly fraction is additionally scaled down by `λ_K < 1`. Size
can only decrease under the caps, never increase.

---

## I8 — Never assume an order succeeded without confirmation

**Why.** Submission ≠ acceptance ≠ fill. Treating a sent order as live corrupts
position and risk accounting.

**Enforcement.** `OrderState` advances only on exchange confirmation. No
position or exposure is booked from an unconfirmed order. Timeouts transition to
`UNKNOWN` → reconcile (see I12).

---

## I9 — Never allow duplicate active entry orders for one trade intent

**Why.** Duplicate entries double exposure and race each other, defeating sizing
and risk caps.

**Enforcement.** The order state machine keys active entry orders by
`TradeIntent.intent_id`; a second active entry for the same intent is rejected.
Replace/cancel-replace goes through the single active slot.

---

## I10 — Never evaluate overlapping market snapshots using random train/test splitting

**Why.** Intrahour snapshots are heavily autocorrelated and overlapping in their
label horizons. Random splits leak the future into training and produce
fantasy backtest metrics.

**Enforcement.** Splits are **time-blocked / purged & embargoed** by hour (and
by market), never shuffled across overlapping windows. The label engine records
`observation_horizon` and censoring so overlap is explicit. Any random
`train_test_split` on snapshot rows is a review failure.

---

## I11 — Never count expected rebates as core alpha

**Why.** Rebates are a fragile, policy-dependent kicker. A strategy that is only
profitable because of assumed rebates is not profitable.

**Enforcement.** EV gates (`expected_net_ev`, `ev_lower_confidence_bound`) are
computed **excluding** rebates. Rebates may be reported separately but never
move a trade from -EV to +EV.

---

## I12 — Never allow live trading to default ON after deployment

**Why.** A deploy, restart, or rollback must never silently start sending real
orders.

**Enforcement.** `TRADING_ENABLED` defaults to `false` everywhere (code default,
env default, infra default). Enabling is an explicit, logged, auditable action.
On any fresh start the trader comes up in shadow.

---

## I13 — If order state is uncertain, FREEZE new entries and RECONCILE

**Why.** Acting on an unknown order book of our own invites double-fills and
runaway exposure.

**Enforcement.** On `UNKNOWN` order state, timeout, or reject-rate breach
(`MAX_ORDER_REJECTS`, `MAX_UNKNOWN_ORDERS`), the system enters
`RiskState.entries_frozen = true`, reconciles against the exchange, and only
resumes entries once reconciled.

---

## I14 — If feed state is uncertain, STOP new orders

**Why.** Every decision is a function of fresh feeds. Uncertain feeds = blind
trading.

**Enforcement.** Feed-health monitor degrades `FeedHealth`; any degraded feed
(age, gap, reconnect storm via `MAX_RECONNECT_RATE`, clock drift via
`MAX_CLOCK_DRIFT`) flips `feed_healthy` false and halts new orders. Open
positions are managed under a defined degraded-mode exit policy, not abandoned.

---

## Summary gate table

An `Opportunity` may become a live `TradeIntent` only if **all** are true:

| Gate | Backed by |
|------|-----------|
| `market_valid`   | I1 |
| `feed_healthy`   | I5, I6, I14 |
| `clock_synced`   | I5, I6, I14 (`MAX_CLOCK_DRIFT`) |
| `spread_valid`   | I2 (`MAX_SPREAD`) |
| `depth_valid`    | I3 (`MIN_DEPTH`) |
| `risk_valid`     | I7, I13 (caps + not frozen) |
| `model_supported`| artifact `feature_version` + `supported_regime` match |
| `EV_LCB > 0`     | I2, I11 (net, rebate-excluded, lower-confidence) |

Hard gates are evaluated first and independently. A ranking score may *order*
opportunities but may **never** substitute for a gate.
