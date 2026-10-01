# @pmbtc/core

Foundational primitives shared by every production package. Depends only on `@pmbtc/contracts`; no venue/network/db logic.

## Contents

- **time** — `Clock` (injectable), `SystemClock` (the only wall-clock reader), `ManualClock` (replay/tests; forward-only), `ageMs`/`isStale` staleness helpers (I5/I6), `MS` units.
- **result** — `Result<T,E>` with `ok`/`err`/`map`/`mapErr`/`unwrap`/`unwrapOr` for expected-failure boundaries.
- **errors** — `AppError` with stable `code`, `InvariantViolation`, `ErrorCode` registry.
- **ids** — `IdGenerator`; `DeterministicIdGenerator` (reproducible, for replay) and `RandomIdGenerator` (live idempotency keys).
- **logger** — `SystemEventLogger` emitting `SystemEvent`s with injected clock/ids; `ConsoleEventSink`, `CollectingEventSink`.

Time and ids are injected so the deterministic model path never reads wall-clock or RNG (MATH_SPEC §Determinism).
