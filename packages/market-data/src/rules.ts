import type { MarketDefinition } from '@pmbtc/contracts';

/**
 * Market-rule validation — the enforcement point for Invariant I1 ("never trade a
 * market whose resolution rules have not been validated"). This is the
 * venue-independent VALIDATOR: given a parsed MarketDefinition, it decides whether
 * the rules are coherent and the market is safe to trade. The venue-specific
 * PARSER (raw venue JSON -> MarketDefinition) is separate and lives with market
 * discovery; it must run this before marking a market tradeable.
 *
 * Fail-closed: anything we cannot positively affirm makes the market invalid.
 */

export interface RulesValidationOptions {
  /**
   * Settlement sources we recognize and have validated our model against. I1
   * requires this: trading a market whose settlement source we don't understand
   * means our probability model may target the wrong event. If omitted/empty,
   * NO market validates (we cannot claim validation without a known source).
   */
  allowedSettlementSources?: readonly string[];
  /** Minimum sane seconds between open and close (reject degenerate windows). */
  minWindowSeconds?: number;
}

export interface RulesValidationResult {
  valid: boolean;
  /** Human-readable reasons a market failed (empty when valid), for audit. */
  notes: string[];
}

/**
 * Validate a MarketDefinition's resolution rules. Returns valid + the list of
 * failures. Does not mutate; use {@link markValidated} to stamp the decision onto
 * a definition.
 */
export function validateMarketDefinition(
  def: MarketDefinition,
  opts: RulesValidationOptions = {},
): RulesValidationResult {
  const notes: string[] = [];

  if (!(def.strike > 0) || !Number.isFinite(def.strike)) {
    notes.push(`strike must be a positive finite number (got ${def.strike})`);
  }
  if (!def.underlying) notes.push('underlying is empty');

  if (!(def.close_time > def.open_time)) {
    notes.push(`close_time (${def.close_time}) must be after open_time (${def.open_time})`);
  } else {
    const windowSeconds = (def.close_time - def.open_time) / 1000;
    const minWindow = opts.minWindowSeconds ?? 1;
    if (windowSeconds < minWindow) {
      notes.push(`market window ${windowSeconds}s is below minimum ${minWindow}s`);
    }
  }

  if (!(def.tick_size > 0) || !(def.tick_size < 1)) {
    notes.push(`tick_size must be in (0, 1) (got ${def.tick_size})`);
  }
  if (!(def.min_order_size > 0)) {
    notes.push(`min_order_size must be > 0 (got ${def.min_order_size})`);
  }

  if (!def.token_ids.YES || !def.token_ids.NO) {
    notes.push('token_ids must include non-empty YES and NO ids');
  }

  // I1 core: the settlement source must be one we recognize.
  const allow = opts.allowedSettlementSources;
  if (!allow || allow.length === 0) {
    notes.push('no settlement-source allowlist configured: cannot affirm rules (fail-closed)');
  } else if (!def.settlement_source) {
    notes.push('settlement_source is empty');
  } else if (!allow.includes(def.settlement_source)) {
    notes.push(`settlement_source "${def.settlement_source}" is not in the recognized allowlist`);
  }

  return { valid: notes.length === 0, notes };
}

/**
 * Return a copy of `def` with `rules_validated` and `validation_notes` set from a
 * validation run. The discovery layer calls this before persisting a market so
 * downstream gates read a single source of truth.
 */
export function markValidated(
  def: MarketDefinition,
  opts: RulesValidationOptions = {},
): MarketDefinition {
  const result = validateMarketDefinition(def, opts);
  return {
    ...def,
    rules_validated: result.valid,
    ...(result.notes.length > 0 ? { validation_notes: result.notes.join('; ') } : {}),
  };
}
