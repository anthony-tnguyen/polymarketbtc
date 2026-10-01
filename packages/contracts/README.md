# @pmbtc/contracts

The **single source of truth** for every data shape that crosses a package,
process, database, or S3 boundary. Everything depends on this package; it
depends on nothing but Zod.

## Rules

- Every schema is a **Zod** schema. The TypeScript type is **inferred**
  (`z.infer`), never written in parallel.
- Do not redefine a contract elsewhere. Import it from `@pmbtc/contracts`.
- Keep this package free of I/O and logic — shapes and validators only.
- All timestamps are epoch **milliseconds** (UTC, integer). Ingested events
  carry both `exchange_timestamp` and `receive_timestamp` (`TimestampPair`) and
  the two are never collapsed (Invariants I5/I6).
- Probabilities and Polymarket prices are in `[0, 1]`.
- IDs are **branded** strings so a `MarketId` cannot be passed where an
  `OrderId` is expected.

## Contents

| Domain | Schemas |
|--------|---------|
| `common` | ids, timestamps, enums (`Side`, `VolatilityRegime`, …), `Version`, `FEATURE_VERSION` |
| `market` | `MarketDefinition` (incl. `rules_validated`), `MarketSnapshot` |
| `btc` | `BTCState` |
| `book` | `PolymarketBook`, `BookLevel` |
| `features` | `FeatureVector` |
| `model` | `ModelPrediction`, `TargetProbability`, `ModelArtifactMeta` |
| `opportunity` | `Opportunity` (the canonical scanner object) |
| `trade` | `TradeIntent`, `OrderIntent`, `OrderState`, `FillEvent`, `PositionState`, `ExitDecision` |
| `risk` | `RiskLimits`, `RiskState` |
| `health` | `FeedHealth`, `SystemEvent` |

## Usage

```ts
import { Opportunity, type Opportunity as OpportunityT } from '@pmbtc/contracts';

const opp = Opportunity.parse(raw); // throws on invalid; opp is fully typed
```

## Scripts

```bash
npm run build      # emit dist/ (.js + .d.ts)
npm run typecheck
npm test           # runtime schema tests
```
