# polymarket-btc-bot

Production trading bot for **Polymarket BTC hourly target-price contracts**. The
edge is **intrahour probability repricing** — buy the target-facing side while
it is cheap and BTC is still statistically capable of reaching the strike, then
exit into a repriced *executable* bid. We optimize **realized net EV per dollar
at risk**, not win rate.

## Start here

- **[AGENTS.md](./AGENTS.md)** — operating contract for everyone touching the repo.
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — how the pieces fit together.
- **[docs/TRADING_INVARIANTS.md](./docs/TRADING_INVARIANTS.md)** — the non-negotiable rules.
- **[docs/MATH_SPEC.md](./docs/MATH_SPEC.md)** — the objective and formal definitions.

## Status

Foundation stage. The shared contracts (`packages/contracts`) are the spine and
must be stable before major parallel development. Build-out follows the phased
plan in `AGENTS.md` (Recorder → Features → Labels → Replay → … → Shadow → Tiny-Live).

## Workspace

npm workspaces, Node ≥ 22, TypeScript. Zod defines every boundary schema; TS
types are inferred from it.

```bash
npm install
npm run build        # build all packages
npm run typecheck
npm test             # run package test suites
```

### Layout

```
apps/        trader (stateful, ECS Fargate) + dashboard (Lovable, read-only)
packages/    contracts · core · market-data · features · execution · risk · replay
research/    Gemini model research (never imported by production)
models/      frozen, versioned model artifacts (*.json)
db/          SQL schema + migrations
infra/cdk/   AWS CDK (TypeScript)
tests/       unit · integration · replay · adversarial
docs/        architecture, invariants, math spec
```

## Safety

`TRADING_ENABLED` defaults to **false**. Live trading never defaults ON after a
deploy; enabling it is an explicit, auditable action. See the invariants.
