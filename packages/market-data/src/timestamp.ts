import type { EpochMillis } from '@pmbtc/contracts';
import { err, ok, type Result } from '@pmbtc/core';

/**
 * Magnitude-aware numeric-timestamp parsing.
 *
 * A numeric venue timestamp must NOT be blindly assumed to be milliseconds —
 * venues variously emit seconds, milliseconds, microseconds, or nanoseconds, and
 * misreading the unit silently corrupts replay ordering, volatility, target
 * velocity, repricing-lag measurement, and first-passage labels. We infer the
 * unit from the value's magnitude and reject anything ambiguous or implausible.
 *
 *   ~1e9   seconds        ~1e12  milliseconds
 *   ~1e15  microseconds   ~1e18  nanoseconds
 *
 * The inference is unambiguous because the four unit scales are separated by
 * factors of 1000 while a *plausible* epoch spans less than a factor of two, so
 * at most one scale maps a given value into the plausible window.
 */

/** Plausible epoch-ms window. A value outside it (in every unit) is rejected. */
export const PLAUSIBLE_MIN_MS = Date.parse('2017-01-01T00:00:00Z'); // 1_483_228_800_000
export const PLAUSIBLE_MAX_MS = Date.parse('2035-01-01T00:00:00Z'); // 2_051_222_400_000

export type TimestampUnit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds';

/** Factor to convert a value in each unit to milliseconds. */
const UNIT_TO_MS: Readonly<Record<TimestampUnit, number>> = {
  seconds: 1_000,
  milliseconds: 1,
  microseconds: 1e-3,
  nanoseconds: 1e-6,
};

export interface TimestampParse {
  ms: EpochMillis;
  unit: TimestampUnit;
}

export class TimestampError extends Error {
  readonly code: 'not-finite' | 'non-positive' | 'implausible' | 'ambiguous' | 'empty' | 'unparseable';
  constructor(code: TimestampError['code'], message: string) {
    super(message);
    this.name = 'TimestampError';
    this.code = code;
  }
}

/**
 * Infer the unit of a numeric timestamp from its magnitude and return epoch ms.
 * Fails closed on non-finite, non-positive, implausible (out of range in every
 * unit), or ambiguous (plausible in more than one unit) values.
 */
export function parseNumericTimestamp(value: number): Result<TimestampParse, TimestampError> {
  if (!Number.isFinite(value)) {
    return err(new TimestampError('not-finite', `timestamp is not finite: ${value}`));
  }
  if (value <= 0) {
    return err(new TimestampError('non-positive', `timestamp must be positive: ${value}`));
  }

  const candidates: TimestampParse[] = [];
  for (const unit of Object.keys(UNIT_TO_MS) as TimestampUnit[]) {
    const ms = value * UNIT_TO_MS[unit];
    if (ms >= PLAUSIBLE_MIN_MS && ms <= PLAUSIBLE_MAX_MS) {
      candidates.push({ ms: Math.round(ms), unit });
    }
  }

  if (candidates.length === 0) {
    return err(
      new TimestampError(
        'implausible',
        `timestamp ${value} is implausible in every unit (outside ${PLAUSIBLE_MIN_MS}..${PLAUSIBLE_MAX_MS} ms)`,
      ),
    );
  }
  if (candidates.length > 1) {
    return err(
      new TimestampError(
        'ambiguous',
        `timestamp ${value} is ambiguous across units: ${candidates.map((c) => c.unit).join(', ')}`,
      ),
    );
  }
  return ok(candidates[0]!);
}

/**
 * Parse a venue timestamp that may be a number, a numeric string, or an ISO-8601
 * datetime string, to epoch ms. Numeric inputs go through the magnitude-aware
 * parser; ISO strings are parsed and range-checked. Fails closed on
 * absent/unparseable/implausible input so the caller can flag a timestamp
 * anomaly (feed-health) rather than record a wrong time.
 */
export function parseVenueTimestamp(
  raw: string | number | null | undefined,
): Result<TimestampParse, TimestampError> {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    return err(new TimestampError('empty', 'timestamp is absent'));
  }
  if (typeof raw === 'number') {
    return parseNumericTimestamp(raw);
  }
  const s = raw.trim();
  // Purely numeric (optionally fractional) string -> magnitude-aware.
  if (/^\d+(\.\d+)?$/.test(s)) {
    return parseNumericTimestamp(Number(s));
  }
  // Otherwise expect ISO-8601.
  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) {
    return err(new TimestampError('unparseable', `not a numeric or ISO-8601 timestamp: ${s}`));
  }
  if (parsed < PLAUSIBLE_MIN_MS || parsed > PLAUSIBLE_MAX_MS) {
    return err(new TimestampError('implausible', `ISO timestamp ${s} is outside the plausible window`));
  }
  return ok({ ms: parsed, unit: 'milliseconds' });
}
