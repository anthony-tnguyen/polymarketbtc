import type { BookLevel } from '@pmbtc/contracts';

/** Which side of the ladder. */
export type LadderSide = 'bid' | 'ask';

/**
 * A deterministic price→size ladder for one instrument. Shared by the Binance
 * depth book and the Polymarket book since both are price-keyed ladders.
 *
 * Determinism: levels are stored keyed by price and ALWAYS sorted numerically
 * on read, so output never depends on insertion/iteration order (a hard
 * requirement, MATH_SPEC §Determinism). Prices are the doubles parsed from the
 * venue's canonical decimal strings; parsing a given decimal string to an IEEE
 * double is platform-independent, so keys are stable.
 */
export class Ladder {
  readonly #bids = new Map<number, number>();
  readonly #asks = new Map<number, number>();

  #book(side: LadderSide): Map<number, number> {
    return side === 'bid' ? this.#bids : this.#asks;
  }

  /** Apply one level. A size of 0 (or less) removes the level. */
  apply(side: LadderSide, price: number, size: number): void {
    const book = this.#book(side);
    if (size > 0) book.set(price, size);
    else book.delete(price);
  }

  /** Replace the entire ladder from a full snapshot (bids/asks as [price,size]). */
  replace(bids: readonly (readonly [number, number])[], asks: readonly (readonly [number, number])[]): void {
    this.#bids.clear();
    this.#asks.clear();
    for (const [p, s] of bids) if (s > 0) this.#bids.set(p, s);
    for (const [p, s] of asks) if (s > 0) this.#asks.set(p, s);
  }

  /** Drop all state. Used when a desync is detected and we await a resync. */
  clear(): void {
    this.#bids.clear();
    this.#asks.clear();
  }

  /** Levels sorted for display/consumption: bids descending, asks ascending. */
  levels(side: LadderSide): BookLevel[] {
    const entries = [...this.#book(side).entries()];
    entries.sort((a, b) => (side === 'bid' ? b[0] - a[0] : a[0] - b[0]));
    return entries.map(([price, size]) => ({ price, size }));
  }

  bestBid(): number | null {
    let best: number | null = null;
    for (const p of this.#bids.keys()) if (best === null || p > best) best = p;
    return best;
  }

  bestAsk(): number | null {
    let best: number | null = null;
    for (const p of this.#asks.keys()) if (best === null || p < best) best = p;
    return best;
  }

  /** Mid price of top-of-book, or null if either side is empty. */
  mid(): number | null {
    const b = this.bestBid();
    const a = this.bestAsk();
    return b !== null && a !== null ? (b + a) / 2 : null;
  }

  /** Number of price levels on a side. */
  depthCount(side: LadderSide): number {
    return this.#book(side).size;
  }
}
