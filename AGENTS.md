# AGENTS.md

Operating contract for every agent (human or AI) touching this repository.

This file is **normative**. If anything you are told to do conflicts with the
Hard Trading Invariants (`docs/TRADING_INVARIANTS.md`), the invariants win, and
you stop and escalate rather than "work around" them.

---

## 1. What this system is

A production trading bot for **Polymarket US BTC hourly Up/Down contracts**.

Venue is **Polymarket US** (polymarket.us), the CFTC-regulated DCM/DCO — NOT the
international on-chain CLOB (polymarket.com). The two are separate stacks with
different endpoints, token structures, fees, order-book and WebSocket semantics;
international assumptions must never leak into this project (config rejects
international endpoints; see `@pmbtc/contracts` `VenueConfig`).

The product resolves by comparing the official settlement reference (**CF
Benchmarks BRTI**) against the opening reference — it does **not** ask whether
BTC "reaches a strike within the hour" (there is no fixed strike). The edge is
**intrahour probability repricing**, not final-settlement prediction. We buy the
direction-facing contract while it is still cheap and BTC is statistically
capable of moving that way, then exit when probability repricing creates a
favorable *executable* bid. Binance is our fast **predictive** driver only; it is
never settlement truth (Invariant I15).

We optimize **realized net EV per dollar at risk**, not win rate. "First
passage" refers to the **Polymarket contract's executable bid** reaching a
profitable level — not BTC reaching any price. See `docs/MATH_SPEC.md` for the
formal objective and `docs/ARCHITECTURE.md` for how the pieces fit together.

---

## 2. Roles

| Owner        | Scope |
|--------------|-------|
| **Claude Code** (primary) | Production code: monorepo, contracts, ingestion, features, persistence, replay, scanner, entry/execution/risk engines, AWS/infra, CI/CD, integration of model + dashboard artifacts. |
| **Gemini**   | Research & model artifacts under `research/` and `models/`. Produces *versioned, frozen* artifacts only. |
| **Codex**    | Adversarial review. Every major subsystem is handed off for review before it is trusted in shadow or live. |
| **Lovable**  | Dashboard UI (`apps/dashboard`). Consumes **read-only** APIs. Never holds exchange credentials. |

**Research code never silently changes production behavior.** Production
consumes model artifacts by version (see §6). A new model is a new file, a new
version string, and a deliberate config change — never an in-place edit.

---

## 3. Repository layout

```
polymarket-btc-bot/
├── apps/
│   ├── trader/        # stateful production trader (long-running ECS task)
│   └── dashboard/     # Lovable-owned read-only UI
├── packages/
│   ├── contracts/     # shared Zod schemas + inferred TS types (source of truth)
│   ├── core/          # clock, ids, time, result/error primitives
│   ├── market-data/   # Binance WS, Polymarket WS, discovery, rules parser, unified state
│   ├── features/      # deterministic feature engine
│   ├── execution/     # order state machine, maker/taker logic
│   ├── risk/          # hard risk limits (independent of model logic)
│   └── replay/        # event-driven backtester / label engine
├── research/          # Gemini: notebooks, training (NOT imported by production)
├── models/            # frozen, versioned model artifacts (*.json)
├── db/                # SQL migrations, schema
├── infra/cdk/         # AWS CDK (TypeScript)
├── tests/{unit,integration,replay,adversarial}/
└── docs/
```

`packages/contracts` is the **single source of truth** for data shapes crossing
a package boundary, a process boundary, the database, or S3. It must be
completed and stable before major parallel development. Do not duplicate a
type; import it from `@pmbtc/contracts`.

---

## 4. Stack rules

- **TypeScript** for all production code (trader, engines, infra).
- **Python** only where quant/model integration genuinely requires it, under
  `research/`. It is never on the live trading path.
- **Zod** defines every external/boundary schema; TS types are *inferred* from
  Zod (`z.infer`), never hand-written in parallel.
- **PostgreSQL** (AWS RDS) for state; **S3** for raw-event archival.
- **ECS Fargate** runs the stateful trader — **never Lambda** for the trader.
- **ECR** for images, **Secrets Manager** for credentials, **CloudWatch** for
  logs/metrics, **IAM** least-privilege.
- **AWS CDK in TypeScript** for all infrastructure. No click-ops.

---

## 5. How to work

Build incrementally. For **every** subsystem, in order:

1. **Implement** against the contracts in `packages/contracts`.
2. **Test** — unit tests for logic, property tests for determinism.
3. **Replay** — run it through the replay engine on recorded data.
4. **Document assumptions** — especially execution/liquidity/latency ones.
5. **Commit cleanly** — small, reviewable commits, conventional messages.
6. **Hand off** to Codex for adversarial review before it is trusted.

Do not introduce abstractions a subsystem does not yet need. Optimize for fast,
testable production progress.

### Determinism is a hard requirement

Replaying identical historical events **must** produce identical feature and
label output, bit-for-bit. No wall-clock reads, no `Date.now()`, no RNG, no map
iteration-order dependence inside the feature/label path. Time comes from the
event stream. See `docs/MATH_SPEC.md` §Determinism.

### Timestamps

Every ingested event carries **both** `exchange_timestamp` (source of truth for
ordering/latency) and `receive_timestamp` (local). Never collapse them.

---

## 6. Model artifact contract

Production loads artifacts from `models/` (e.g. `touch-v001.json`,
`stop-risk-v001.json`, `continuation-v001.json`). Each **must** declare:

```
model_version, feature_version, training_range, validation_range,
metrics, supported_regime
```

The trader **refuses to use** a model whose `feature_version` does not match the
running feature engine, or whose `supported_regime` excludes the current regime.
A model that does not gate itself is a model we do not run.

---

## 7. Safety defaults (see docs/TRADING_INVARIANTS.md for the full list)

- `TRADING_ENABLED` defaults to **false**. Live trading never defaults ON after
  a deploy. Turning it on is an explicit, auditable action.
- Uncertain **order** state → freeze new entries, reconcile.
- Uncertain **feed** state → stop placing orders.
- Hard risk limits always override model sizing. Kelly can only ever *reduce*
  size below the hard caps, never raise it.
- Every real trade in Tiny-Live has a simultaneous **shadow twin**; we track
  `ShadowPnL − LivePnL` and do not scale until simulation bias is understood.

---

## 8. Secrets & credentials

- Never commit secrets. `.env` is gitignored; `.env.example` documents keys.
- Exchange/private keys live only in **Secrets Manager**, read by the trader
  task role. The dashboard and research code never receive them.
- CI uses scoped, short-lived credentials via OIDC — no long-lived keys in CI.

---

## 9. Definition of done (per subsystem)

- [ ] Types imported from `@pmbtc/contracts` (none duplicated).
- [ ] Unit + determinism/property tests pass.
- [ ] Runs clean through replay on recorded data.
- [ ] Assumptions documented (liquidity, latency, fill model).
- [ ] No Hard Trading Invariant violated.
- [ ] Reviewed by Codex.
