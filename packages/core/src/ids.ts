/**
 * Id generation. On the replay/model path, ids must be reproducible so a replay
 * of identical events yields identical output (determinism invariant). Live code
 * uses random, collision-resistant ids for idempotency keys.
 *
 * Callers brand the returned string into the right id type from @pmbtc/contracts
 * (e.g. `IntentId.parse(gen.next('intent'))`), keeping this package free of the
 * zod dependency.
 */
export interface IdGenerator {
  /** Produce the next id, optionally namespaced by a short prefix. */
  next(prefix?: string): string;
}

/**
 * Deterministic, counter-based generator. Given the same seed and call order it
 * produces the same ids every run — required for replay reproducibility. NOT for
 * live use (ids are predictable and only unique within one generator instance).
 */
export class DeterministicIdGenerator implements IdGenerator {
  #counter = 0;
  readonly #seed: string;

  constructor(seed = 'det') {
    this.#seed = seed;
  }

  next(prefix = 'id'): string {
    const n = ++this.#counter;
    return `${prefix}_${this.#seed}_${n.toString(36).padStart(8, '0')}`;
  }
}

/**
 * Random, collision-resistant generator for live use (idempotency keys, event
 * ids). Uses the platform crypto UUID. Never use on the deterministic path.
 */
export class RandomIdGenerator implements IdGenerator {
  next(prefix = 'id'): string {
    return `${prefix}_${crypto.randomUUID()}`;
  }
}
