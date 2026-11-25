import { Prisma } from '@prisma/client';

/**
 * Money arithmetic for the Phase 4 financial engine.
 *
 * Every monetary value in this codebase is `Decimal(14,2)` in PostgreSQL.
 * Application code must never perform float arithmetic on money: a float
 * round-trip can silently change a cent and post an unbalanced journal.
 *
 * This module is the single place where money is coerced. All accounting
 * services import from here rather than touching `Number()` directly.
 */

export type MoneyInput = Prisma.Decimal | string | number;

/** Monetary scale used by the database (`Decimal(14,2)`). */
export const MONEY_SCALE = 2;

/** FX/unit rate scale used by the database (`Decimal(18,8)`). */
export const RATE_SCALE = 8;

export const ZERO = new Prisma.Decimal(0);
export const ONE = new Prisma.Decimal(1);
export const HUNDRED = new Prisma.Decimal(100);

/**
 * Coerce an input to Decimal without passing through a float.
 * Numbers are stringified first so `0.1 + 0.2` artefacts are not inherited
 * from the caller's arithmetic.
 */
export function dec(value: MoneyInput | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(0);
  if (value instanceof Prisma.Decimal) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid monetary value: ${value}`);
    }
    return new Prisma.Decimal(value.toString());
  }
  return new Prisma.Decimal(value);
}

/** Round to the database monetary scale using half-up (banker-neutral). */
export function money(value: MoneyInput): Prisma.Decimal {
  return dec(value).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Round a rate to the database rate scale. */
export function rate(value: MoneyInput): Prisma.Decimal {
  return dec(value).toDecimalPlaces(RATE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

export function add(...values: MoneyInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(dec(v)), ZERO);
}

export function sub(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return dec(a).minus(dec(b));
}

export function mul(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return dec(a).times(dec(b));
}

export function isZero(value: MoneyInput): boolean {
  return dec(value).isZero();
}

export function isPositive(value: MoneyInput): boolean {
  return dec(value).greaterThan(ZERO);
}

export function isNegative(value: MoneyInput): boolean {
  return dec(value).lessThan(ZERO);
}

export function gte(a: MoneyInput, b: MoneyInput): boolean {
  return dec(a).greaterThanOrEqualTo(dec(b));
}

export function gt(a: MoneyInput, b: MoneyInput): boolean {
  return dec(a).greaterThan(dec(b));
}

export function lte(a: MoneyInput, b: MoneyInput): boolean {
  return dec(a).lessThanOrEqualTo(dec(b));
}

export function lt(a: MoneyInput, b: MoneyInput): boolean {
  return dec(a).lessThan(dec(b));
}

/** Exact equality after rounding both sides to money scale. */
export function moneyEquals(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).equals(money(b));
}

export function minMoney(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return money(a).lessThanOrEqualTo(money(b)) ? money(a) : money(b);
}

export function maxMoney(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return money(a).greaterThanOrEqualTo(money(b)) ? money(a) : money(b);
}

/**
 * Convert a transaction-currency amount into the functional currency.
 * `fxRate` is expressed as functional units per one transaction unit.
 */
export function toBase(amount: MoneyInput, fxRate: MoneyInput): Prisma.Decimal {
  return money(mul(amount, dec(fxRate)));
}

/** Percentage amount, e.g. tax = base * ratePercent / 100. */
export function percentOf(base: MoneyInput, ratePercent: MoneyInput): Prisma.Decimal {
  return money(dec(base).times(dec(ratePercent)).dividedBy(HUNDRED));
}

/** Serialise for API responses without losing precision. */
export function moneyString(value: MoneyInput): string {
  return money(value).toFixed(MONEY_SCALE);
}

/** True when the value has more than 2 decimal places (would be rounded). */
export function hasSubCentPrecision(value: MoneyInput): boolean {
  return dec(value).decimalPlaces() > MONEY_SCALE;
}

/** Natural balance sign: debit-normal accounts increase on debit. */
export function signedDelta(
  normalBalance: 'DEBIT' | 'CREDIT',
  debit: MoneyInput,
  credit: MoneyInput
): Prisma.Decimal {
  const debitAmt = money(debit);
  const creditAmt = money(credit);
  return normalBalance === 'DEBIT'
    ? debitAmt.minus(creditAmt)
    : creditAmt.minus(debitAmt);
}

/** Normal balance implied by an account type. */
export function normalBalanceForType(
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
): 'DEBIT' | 'CREDIT' {
  switch (type) {
    case 'ASSET':
    case 'EXPENSE':
      return 'DEBIT';
    case 'LIABILITY':
    case 'EQUITY':
    case 'REVENUE':
      return 'CREDIT';
  }
}
