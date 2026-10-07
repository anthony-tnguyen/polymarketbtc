# MATH SPEC

The formal objective, the modeling targets, and the definitions the rest of the
system refers to by name. Notation is kept close to the code: a symbol here maps
to a field in `packages/contracts`.

---

## 1. Objective

We maximize **realized net EV per dollar at risk**, not win rate:

```
maximize   E[ net_pnl ] / capital_at_risk
```

over the population of trades we actually take. Win rate is not optimized and is
not a target; a low-win-rate, high-EV policy is preferred to its opposite.

---

## 2. Primary modeling target — first passage

Let `X_t` be the feature/state vector at decision time `t`. Let `T_q` be the
**first time the executable Polymarket bid reaches profit target `q`** (measured
as repricing from our entry, net of costs). The primary target is the
first-passage CDF:

```
P( T_q ≤ h | X_t )
```

for profit targets `q ∈ {0.5%, 1.0%, ...}` (ticks per dollar at risk) and
horizons `h ∈ {60s, 180s, ...}`. These populate the `p_tp_*` fields on
`Opportunity` (e.g. `p_tp_05_60s = P(T_{0.5%} ≤ 60s | X_t)`).

**First passage is about the contract, not BTC.** `T_q` is the first time the
*Polymarket executable bid* reaches a profitable level — it is **not** the time
BTC reaches any price or "touches a strike". BTC movement (via Binance) and the
BRTI reference are *predictors* of that contract repricing; they are not the
barrier itself.

### Competing risks

We also model the race between taking profit and hitting a stop:

```
P( T_TP < T_STOP | X_t )  →  Opportunity.p_tp_before_stop
```

where `T_TP = T_q` for the chosen target and `T_STOP` is the first-passage time
to the stop threshold. This is a **competing-risks** problem (the first barrier
hit ends the episode), not two independent survival problems.

---

## 3. Executable prices (never midpoint)

Given the `PolymarketBook` ladder and a size `Q`, define the size-aware
volume-weighted execution prices:

```
EntryVWAP(Q)  = VWAP of the ask ladder consumed to acquire Q    (we buy)
VWAPBid_u(Q)  = VWAP of the bid ladder we could sell Q into at time u
```

Both walk the ladder level by level and stop at available depth (Invariant I3).
If depth < Q, the remainder is **not** executable. The displayed midpoint is
never used in any of the quantities below (Invariant I2).

---

## 4. Labels (size-aware, executable)

For an episode entered at `Q` with observation window up to `observation_horizon`:

```
ExecutableMFE(Q) = max_u ( VWAPBid_u(Q) − EntryVWAP(Q) )
ExecutableMAE(Q) = min_u ( VWAPBid_u(Q) − EntryVWAP(Q) )
```

Hitting times (first `u` such that the running executable P&L crosses a level):

```
time_to_tp_02, time_to_tp_05, time_to_tp_10, time_to_tp_15, time_to_tp_20
time_to_stop_03, time_to_stop_05, time_to_stop_10
tp_before_stop  ∈ {true, false}      (which barrier was hit first)
```

**Censoring.** If the window ends (hour resolves, or `observation_horizon`
elapses) before a barrier is hit, the label is **censored**: `censored = true`,
`censor_reason ∈ {horizon, market_resolved, feed_gap, ...}`. Censored labels are
kept and handled by the survival estimator; they are never silently dropped or
treated as "no event". `observation_horizon` is always recorded so overlap is
explicit (Invariant I10).

---

## 5. Features (deterministic)

All features are pure functions of the ordered event stream (time injected,
no wall-clock, no RNG). Replay reproduces them exactly. `feature_version` tags
the implementation; a model is only `model_supported` if its `feature_version`
matches.

- **`distance_sigma`** — signed distance of BTC from the **opening reference**
  (BRTI) in units of expected move over the remaining time:
  `(opening_reference − btc_price) / (σ · √(seconds_remaining))`. There is no
  fixed strike for the US Up/Down product; the comparison is reference-based.
- **`basis_usd`, `basis_bps`** — signed basis between the Binance driver and the
  BRTI reference (`binance − brti`). Underlying flow is never conflated with
  prediction-market flow.
- **`ewma_volatility`**, **`volatility_ratio`** — EWMA of returns; ratio of
  short- to long-window vol (regime proxy).
- **`target_velocity_{5,15,30,60}s`** — rate of change of BTC toward the opening
  reference over each lookback.
- **`target_acceleration`** — change in `target_velocity`.
- **`btc_ofi_{5,15,30,60}s`** / **`poly_ofi_{5,15,30,60}s`** — order-flow
  imbalance of the Binance book and the Polymarket US book respectively, over
  each window (kept separate; they are different processes).
- **`btc_obi`** / **`poly_obi_l1`, `poly_obi_l5`, `poly_obi_l10`** — Binance
  order-book imbalance, and Polymarket order-book imbalance at 1/5/10 levels.
- **`btc_microalpha`** — short-horizon fair-value drift estimate from BTC
  microstructure. **`poly_quote_velocity`** — Polymarket requote rate.
- **`spread`, `depth`, `ladder_residual`** — Polymarket book-shape features
  (`ladder_residual` = deviation of the observed ladder from its fitted shape).

`volatility_regime` (a discrete label) is derived from `volatility_ratio` and
drives `supported_regime` gating.

---

## 6. Entry gate

Hard gates (Invariants, evaluated first and independently):

```
market_valid ∧ feed_healthy ∧ clock_synced ∧ spread_valid ∧ depth_valid
             ∧ risk_valid ∧ model_supported
```

Then the economic gate on the **net** EV lower-confidence bound (rebates
excluded, Invariant I11):

```
EV_net^LCB  =  Ê[EV_net] − z_α · SE(EV_net)   >   0
```

`z_α` is the chosen confidence multiplier (e.g. `α = 0.05`). This maps to
`Opportunity.ev_lower_confidence_bound`. A weighted ranking **score** may order
passing opportunities but can never replace this gate (Invariant: a score is not
a gate).

---

## 7. Target / horizon optimization

For target `q` and max wait `h`, the per-trade expected value is:

```
EV(q, h) =  P(T_q ≤ h) · Profit(q)
          − P(T_stop < T_q) · Loss
          − Costs(q, h)
```

where `Costs` includes fees, expected slippage (size-aware), and the
continuation-value opportunity cost of waiting. We select:

```
(q*, h*) = argmax_{q, h}  EV(q, h)
```

populating `optimal_target` and `optimal_horizon`. Every resulting trade is
fully specified by:

```
entry, target, max_hold, state_stop, hard_stop, size
```

(`state_stop` = exit driven by state/model deterioration; `hard_stop` = price
barrier; `max_hold` = time barrier.)

---

## 8. Execution — maker-first when the signal allows

Default to **maker-first** only when the signal half-life supports waiting for a
fill. Choose maker vs. taker by comparing expected values explicitly:

```
EV_maker  =  P(fill) · EV_filled        (P(fill) is queue-aware, Invariant I4)
EV_taker  =  EV of immediately crossing the spread
choose maker  iff  EV_maker > EV_taker
```

`P(fill)` is modeled from: queue-ahead volume, trade-through rate, cancel rate,
quote movement, signal half-life, spread, fee, and slippage. Both
`maker_fill_probability` and `taker_fill_probability` appear on `Opportunity`.

---

## 9. Position sizing — generalized fractional Kelly under hard caps

Consume empirical return distributions `R` from the Gemini artifacts. The Kelly
fraction solves:

```
f* = argmax_f  E[ log(1 + f·R) ]
```

We trade a *fraction* of it (Invariant: Kelly only shrinks size):

```
f_live = λ_K · f*            (0 < λ_K < 1)
```

The actual size is the **minimum** of the Kelly size and every hard cap
(Invariant I7 — caps always win):

```
Q = min( KellySize, LiquidityCap, StrikeCap, HourlyCap, DailyCap )
```

`LiquidityCap` is derived from executable book depth (Invariant I3).

---

## 10. Risk measures

- **`cvar95`** — expected loss in the worst 5% tail of the trade's P&L
  distribution (CVaR at 95%). Reported per `Opportunity`; also aggregated at the
  portfolio level by the risk engine.
- **`expected_mfe` / `expected_mae`** — model estimates of the executable MFE/MAE
  the labels define in §4, used for exit targeting and sanity-checking fills.

---

## 11. Determinism (hard requirement)

The feature and label path must be a pure function of its inputs:

- Time is supplied by the event stream (`exchange_timestamp`), never
  `Date.now()`.
- No RNG on the model path. Any stochastic estimation is done offline in
  `research/` and frozen into a `models/*.json` artifact.
- No dependence on map/set iteration order, floating-point nondeterminism across
  platforms, or concurrency ordering.

A replay of identical historical events must produce **identical** feature and
label output. This is tested as a property, not assumed.

---

## 12. Shadow / live reconciliation

In Tiny-Live every real trade has a simultaneous shadow twin fed the same
events. We track:

```
divergence = ShadowPnL − LivePnL
```

per trade and in aggregate. Persistent nonzero divergence means our simulation
(fill model, latency, depth consumption) is biased; we do not scale size until
the bias is understood and corrected.
