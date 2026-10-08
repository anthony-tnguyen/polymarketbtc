# ARCHITECTURE

How the Polymarket BTC hourly target-price trading system fits together.

Read alongside `TRADING_INVARIANTS.md` (the rules the design must never break)
and `MATH_SPEC.md` (the objective and the formal definitions this document
refers to by name).

---

## 1. The strategy in one paragraph

Our venue is **Polymarket US** (polymarket.us), the CFTC-regulated DCM/DCO — not
the international on-chain CLOB (polymarket.com). It lists hourly BTC **Up/Down**
contracts: each hour resolves by comparing the official settlement reference
(**CF Benchmarks BRTI**) over the settlement window against the opening reference
over the opening window — UP pays if BTC closed above the opening reference, DOWN
otherwise. BTC does **not** have to "touch a strike"; there is no fixed strike for
this product. The contract price is a market-implied probability that moves
continuously as BTC moves and as the hour elapses. We do **not** try to predict
final settlement. We buy the direction-facing side while it is cheap and BTC is
still statistically capable of moving that way, then **exit into a repriced
executable bid** once probability has moved in our favor. The modeling question
is therefore not "will it settle up?" but "what is the probability that the
*executable Polymarket bid* reaches a profit target `q` within horizon `h`,
before hitting a stop?" — a **first-passage / competing-risks** problem, where
*first passage refers to the Polymarket contract's executable bid reaching a
profitable level, not BTC reaching any price*. Binance is our fast predictive
driver; it is **never** settlement truth (see TRADING_INVARIANTS I15).

---

## 2. Design principles

1. **Executable, not displayed.** Every P&L, MFE/MAE, and EV number is computed
   against what we could actually transact against the book — never the
   displayed midpoint. (Invariant.)
2. **Determinism on the model path.** Features and labels are pure functions of
   the ordered event stream. Replay reproduces them exactly.
3. **Contracts are the spine.** `packages/contracts` defines every shape that
   crosses a boundary. Everything else depends on it; it depends on nothing.
4. **Hard limits are separate from model logic.** The risk engine can veto any
   action and knows nothing about EV. Sizing can only shrink under the caps.
5. **Record first, trade last.** We build the recorder and replay before any
   execution, so the backtester and the live system share one event model.
6. **Fail safe.** Uncertainty (feed or order state) halts action; it never
   guesses.

---

## 3. Dataflow (the event pipeline)

The same ordered pipeline runs in **replay** and **live**; only the sources and
sinks differ. This is what makes backtest and production comparable.

```
 Binance WS  ──▶ BTCState (predictive) ─┐
 BRTI feed   ──▶ ReferencePriceState ───┤
                                        ├─▶ UnifiedMarketState ─▶ FeatureVector ─▶ ModelPrediction
 Polymarket US WS ─▶ PolymarketBook ────┘   (+ Binance−BRTI basis)               │
 Discovery   ─▶ MarketDefinition ─▶ rules validation ─▶ (gate)                   ▼
                                                                        Opportunity
                                                                             │
                                               RiskState ◀── hard gates ─────┤
                                                                             ▼
                                                                        TradeIntent
                                                                             │
                                                                        OrderIntent
                                                                             │
                                                   OrderState (state machine)│
                                                                             ▼
                                                              FillEvent ─▶ PositionState
                                                                             │
                                                                        ExitDecision
```

Every node consumes and emits types from `@pmbtc/contracts`. A `SystemEvent` can
be emitted at any node (reconnects, gaps, freezes, rejects) and is persisted.

### Live vs. replay

| Stage | Live source/sink | Replay source/sink |
|-------|------------------|--------------------|
| Binance (predictive driver) | real WS | recorded events from S3/PG |
| BRTI (official reference) | reference feed | recorded reference events |
| Polymarket US | real Markets WS (full snapshot/msg) | recorded full-book snapshots |
| Clock | NTP-disciplined monotonic | event `exchange_timestamp` |
| Orders | CLOB API | simulated fill model (queue/depth/latency aware) |
| Fills | exchange confirmations | synthetic `FillEvent` from book + fill model |
| Persistence | RDS + S3 | read-only replay DB / fixtures |

---

## 4. Packages

- **`contracts`** — Zod schemas + inferred TS types. Source of truth. No logic,
  no I/O, no dependencies on other packages.
- **`core`** — clock & time utilities, id/ULID generation, `Result`/error
  types, structured logging shape. The only place allowed to touch wall-clock,
  and even there the model path receives time via injection.
- **`market-data`** — Binance WS client (predictive driver), Polymarket **US**
  Markets WS client (full snapshot per message, no sequence number), the BRTI
  reference feed, market discovery, **rules parser/validator**, magnitude-aware
  timestamp parsing, clock synchronization, and the **unified state engine** that
  merges BTC + BRTI + book (plus the Binance−BRTI basis) into
  `UnifiedMarketState`. Also the raw-frame capture + S3 archiver, the Postgres
  derived-state sink, and the feed-health monitor. Venue config
  (`@pmbtc/contracts` `VenueConfig`) rejects international Polymarket endpoints.
- **`features`** — deterministic feature engine producing `FeatureVector`.
  Pure; time injected; versioned (`feature_version`).
- **`risk`** — hard limits and the freeze/reconcile logic. Independent of model
  code. Emits/consumes `RiskState`.
- **`execution`** — order state machine, maker-first vs. taker decision, fill
  accounting. Consumes `OrderIntent`, drives `OrderState`, emits `FillEvent`.
- **`replay`** — event-driven backtester and the **label engine** (first-passage
  / competing-risks labels, size-aware executable MFE/MAE). Shares the pipeline
  above.

### Apps

- **`apps/trader`** — the long-running, stateful process. Wires the packages,
  owns the scanner, entry engine, target/horizon optimizer, position manager,
  exit engine, and the shadow/live toggle. Runs on ECS Fargate.
- **`apps/dashboard`** — Lovable-owned. Reads the read-only API only.

---

## 5. The Opportunity object

The scanner reduces every candidate market to one canonical `Opportunity` (full
field list in `packages/contracts` and `MATH_SPEC.md`). It bundles: market
identity & side; BTC/time context (`btc_price`, `seconds_remaining`,
`distance_sigma`, `volatility_regime`); microstructure (`ofi`, `obi`,
`microalpha`, book `spread`/`depth`); the model outputs
(`fair_probability`, the `p_tp_*` first-passage probabilities,
`p_tp_before_stop`, `expected_mfe`/`expected_mae`, `optimal_target`/
`optimal_horizon`, maker/taker fill probabilities); and the decision economics
(`expected_net_ev`, `ev_lower_confidence_bound`, `cvar95`, and the
`recommended_entry`/`recommended_size`/`recommended_exit`), tagged with
`model_version`.

An `Opportunity` is a *proposal*. It becomes a `TradeIntent` only after the hard
gates (market validity, feed health, clock sync, spread/depth, risk) pass **and**
the EV lower-confidence bound clears zero. See `MATH_SPEC.md` §Entry.

---

## 6. Order lifecycle

`TradeIntent` → `OrderIntent` → `OrderState` state machine → `FillEvent`(s) →
`PositionState` → `ExitDecision`.

The state machine (`packages/execution`) enforces: no duplicate active entry
order per `TradeIntent`; no order on stale feed/clock; nothing is assumed filled
without confirmation; uncertain state transitions to a `RECONCILE`/freeze path.
States are enumerated in `contracts` (`OrderState.status`).

---

## 7. Persistence & archival

- **PostgreSQL (RDS):** market definitions, snapshots, feature vectors,
  predictions, opportunities, intents, orders, fills, positions, risk state,
  system events. Schema and migrations live in `db/`.
- **S3:** raw, append-only event archive (both timestamps preserved) — the
  substrate for replay and label generation. Write-once; never mutated.

The recorder is Phase 1 and must be correct before anything downstream, because
replay fidelity is bounded by recording fidelity.

---

## 8. Model integration

`models/*.json` are frozen artifacts produced by Gemini. The trader loads them
by version, validates `feature_version` against the running feature engine, and
checks `supported_regime`. A mismatch means the model is **not supported** and
the `model_supported` entry gate fails closed. No research code is imported by
the trader.

---

## 9. Deployment & rollout

AWS via CDK (TypeScript): ECS Fargate (trader), RDS Postgres, S3, ECR, Secrets
Manager, CloudWatch, IAM. CI/CD builds the image, runs unit + replay +
adversarial tests, and deploys with `TRADING_ENABLED=false` by default.

Rollout ladder:

1. **Recorder** (Phase 1) — collect, no decisions.
2. **Shadow** (Phase 11) — full pipeline live, simulated orders/fills/P&L, no
   real orders. Produces calibration data.
3. **Tiny-Live** (Phase 12) — real orders at very small hard caps, each with a
   shadow twin; monitor `ShadowPnL − LivePnL`. Do not scale until simulation
   bias is understood.

---

## 10. Observability

Structured `SystemEvent`s and CloudWatch metrics for: feed health (ages, gaps,
reconnect rate), clock drift, order rejects/unknowns, risk-limit utilization,
scanner throughput, shadow-vs-live divergence, and model calibration. The
dashboard reads these; it never writes and never holds credentials.
