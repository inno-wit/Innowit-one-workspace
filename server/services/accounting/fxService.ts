import { CurrencyCode, ExchangeRateSource, Prisma } from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';
import { ONE, MoneyInput, dec, money, rate, toBase } from './money';

/**
 * Foreign exchange.
 *
 * Rules:
 *  - A rate is never guessed. If no rate covers the date, resolution fails
 *    loudly instead of using 1.0 (a silent 1.0 turns a USD invoice into a KES
 *    invoice and corrupts the ledger).
 *  - Every rate is effective-dated and tenant-scoped.
 *  - Transaction documents snapshot the rate they used, so a later rate change
 *    cannot rewrite history.
 *  - Realized differences are booked when a foreign-currency item is settled;
 *    unrealized differences are booked by period-end revaluation of open
 *    balances. Both post through the canonical journal engine.
 */

export interface CaptureRateInput {
  organizationId: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rateValue: MoneyInput;
  rateDate: Date | string;
  source?: ExchangeRateSource;
  sourceRef?: string | null;
  isOverride?: boolean;
  overrideReason?: string | null;
  createdBy?: string | null;
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'INVALID_DATE', 'Invalid exchange-rate date');
  }
  return date;
}

/** Store a rate. Re-capturing the same source/date updates it rather than duplicating. */
export async function captureRate(
  tx: Prisma.TransactionClient,
  input: CaptureRateInput
): Promise<{ id: string; rate: string; rateDate: Date; source: ExchangeRateSource }> {
  if (input.fromCurrency === input.toCurrency) {
    throw new AppError(400, 'SAME_CURRENCY_RATE', 'A rate is only meaningful between two different currencies');
  }

  const rateValue = rate(input.rateValue);
  if (rateValue.lessThanOrEqualTo(0)) {
    throw new AppError(400, 'INVALID_RATE', 'An exchange rate must be greater than zero');
  }

  const rateDate = toDate(input.rateDate);
  const source = input.source ?? ExchangeRateSource.MANUAL;

  const row = await tx.exchangeRate.upsert({
    where: {
      organizationId_fromCurrency_toCurrency_rateDate_source: {
        organizationId: input.organizationId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rateDate,
        source,
      },
    },
    update: {
      rate: rateValue,
      sourceRef: input.sourceRef ?? null,
      isOverride: input.isOverride ?? false,
      overrideReason: input.overrideReason ?? null,
      createdBy: input.createdBy ?? null,
    },
    create: {
      organizationId: input.organizationId,
      fromCurrency: input.fromCurrency,
      toCurrency: input.toCurrency,
      rate: rateValue,
      rateDate,
      source,
      sourceRef: input.sourceRef ?? null,
      isOverride: input.isOverride ?? false,
      overrideReason: input.overrideReason ?? null,
      createdBy: input.createdBy ?? null,
    },
  });

  return { id: row.id, rate: row.rate.toFixed(8), rateDate: row.rateDate, source: row.source };
}

export interface ResolvedRate {
  rate: Prisma.Decimal;
  /** How the rate was obtained: direct quote, inverted quote, or identity. */
  basis: 'DIRECT' | 'INVERTED' | 'IDENTITY';
  rateDate: Date | null;
  source: ExchangeRateSource | null;
}

/**
 * Resolve functional units per one transaction unit for `from -> to` on `date`.
 *
 * Falls back to the inverse of a `to -> from` quote, because organizations often
 * capture only one direction (CBK publishes KES per USD).
 */
export async function resolveRate(
  tx: Prisma.TransactionClient,
  organizationId: string,
  from: CurrencyCode,
  to: CurrencyCode,
  date: Date | string
): Promise<ResolvedRate> {
  if (from === to) {
    return { rate: ONE, basis: 'IDENTITY', rateDate: null, source: null };
  }

  const onDate = toDate(date);

  const direct = await tx.exchangeRate.findFirst({
    where: {
      organizationId,
      fromCurrency: from,
      toCurrency: to,
      rateDate: { lte: onDate },
    },
    orderBy: [{ rateDate: 'desc' }, { createdAt: 'desc' }],
  });

  if (direct && direct.rate.greaterThan(0)) {
    return { rate: direct.rate, basis: 'DIRECT', rateDate: direct.rateDate, source: direct.source };
  }

  const inverse = await tx.exchangeRate.findFirst({
    where: {
      organizationId,
      fromCurrency: to,
      toCurrency: from,
      rateDate: { lte: onDate },
    },
    orderBy: [{ rateDate: 'desc' }, { createdAt: 'desc' }],
  });

  if (inverse && inverse.rate.greaterThan(0)) {
    const inverted = ONE.div(inverse.rate).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
    return { rate: inverted, basis: 'INVERTED', rateDate: inverse.rateDate, source: inverse.source };
  }

  throw new AppError(
    400,
    'FX_RATE_NOT_FOUND',
    `No ${from}/${to} exchange rate is available on or before ${onDate.toISOString().slice(0, 10)}. Capture the rate before posting.`,
    { fromCurrency: from, toCurrency: to, onDate: onDate.toISOString() }
  );
}

/** Convert a transaction amount into the functional currency. */
export async function toFunctional(
  tx: Prisma.TransactionClient,
  organizationId: string,
  amount: MoneyInput,
  fromCurrency: CurrencyCode,
  functional: CurrencyCode,
  date: Date | string
): Promise<{ amount: Prisma.Decimal; rate: Prisma.Decimal; basis: ResolvedRate['basis'] }> {
  const resolved = await resolveRate(tx, organizationId, fromCurrency, functional, date);
  return { amount: toBase(amount, resolved.rate), rate: resolved.rate, basis: resolved.basis };
}

/**
 * Realized FX on settlement.
 *
 * Positive result = gain (the functional value received exceeds the value the
 * item was booked at); negative = loss.
 */
export function realizedDifference(
  foreignAmount: MoneyInput,
  bookedRate: MoneyInput,
  settlementRate: MoneyInput
): { difference: Prisma.Decimal; isGain: boolean } {
  const bookedBase = toBase(foreignAmount, bookedRate);
  const settledBase = toBase(foreignAmount, settlementRate);
  const difference = money(settledBase.minus(bookedBase));
  return { difference, isGain: difference.greaterThanOrEqualTo(0) };
}

export interface RevaluationLine {
  documentType: 'SALES_INVOICE' | 'SUPPLIER_BILL';
  documentId: string;
  documentNumber: string;
  currency: CurrencyCode;
  openAmount: string;
  bookedBase: string;
  revaluedBase: string;
  difference: string;
}

export interface RevaluationResult {
  asOf: string;
  functionalCurrency: CurrencyCode;
  groups: Array<{
    currency: CurrencyCode;
    closingRate: string;
    receivableDifference: string;
    payableDifference: string;
    lines: RevaluationLine[];
  }>;
}

/**
 * Compute period-end unrealized FX on open AR and AP.
 *
 * This is a read-only calculation. `postRevaluationJournal` turns one currency
 * group into a journal so the calculation and the accounting entry are
 * separately auditable.
 */
export async function computeRevaluation(
  tx: Prisma.TransactionClient,
  organizationId: string,
  functional: CurrencyCode,
  asOf: Date | string
): Promise<RevaluationResult> {
  const onDate = toDate(asOf);

  const [invoices, bills] = await Promise.all([
    tx.salesInvoice.findMany({
      where: {
        organizationId,
        currency: { not: functional },
        postedJournalId: { not: null },
      },
      select: {
        id: true,
        invoiceNumber: true,
        currency: true,
        totalAmount: true,
        paidAmount: true,
        exchangeRate: true,
      },
    }),
    tx.supplierBill.findMany({
      where: {
        organizationId,
        currency: { not: functional },
        postedJournalId: { not: null },
      },
      select: {
        id: true,
        internalNumber: true,
        currency: true,
        totalAmount: true,
        paidAmount: true,
        exchangeRate: true,
      },
    }),
  ]);

  const byCurrency = new Map<CurrencyCode, RevaluationLine[]>();

  const push = (line: RevaluationLine) => {
    const list = byCurrency.get(line.currency) ?? [];
    list.push(line);
    byCurrency.set(line.currency, list);
  };

  const revalue = async (
    documentType: RevaluationLine['documentType'],
    documentId: string,
    documentNumber: string,
    currency: CurrencyCode,
    total: Prisma.Decimal,
    paid: Prisma.Decimal,
    bookedRate: Prisma.Decimal
  ) => {
    const open = money(total.minus(paid));
    if (!open.greaterThan(0)) return;

    const resolved = await resolveRate(tx, organizationId, currency, functional, onDate);
    const bookedBase = toBase(open, bookedRate);
    const revaluedBase = toBase(open, resolved.rate);

    push({
      documentType,
      documentId,
      documentNumber,
      currency,
      openAmount: open.toFixed(2),
      bookedBase: bookedBase.toFixed(2),
      revaluedBase: revaluedBase.toFixed(2),
      difference: money(revaluedBase.minus(bookedBase)).toFixed(2),
    });
  };

  for (const invoice of invoices) {
    await revalue(
      'SALES_INVOICE',
      invoice.id,
      invoice.invoiceNumber,
      invoice.currency,
      dec(invoice.totalAmount),
      dec(invoice.paidAmount),
      dec(invoice.exchangeRate)
    );
  }

  for (const bill of bills) {
    await revalue(
      'SUPPLIER_BILL',
      bill.id,
      bill.internalNumber,
      bill.currency,
      dec(bill.totalAmount),
      dec(bill.paidAmount),
      dec(bill.exchangeRate)
    );
  }

  const groups: RevaluationResult['groups'] = [];

  for (const [currency, lines] of byCurrency) {
    const resolved = await resolveRate(tx, organizationId, currency, functional, onDate);

    const receivable = lines
      .filter((l) => l.documentType === 'SALES_INVOICE')
      .reduce((acc, l) => acc.plus(dec(l.difference)), new Prisma.Decimal(0));

    const payable = lines
      .filter((l) => l.documentType === 'SUPPLIER_BILL')
      .reduce((acc, l) => acc.plus(dec(l.difference)), new Prisma.Decimal(0));

    groups.push({
      currency,
      closingRate: resolved.rate.toFixed(8),
      receivableDifference: money(receivable).toFixed(2),
      payableDifference: money(payable).toFixed(2),
      lines,
    });
  }

  return {
    asOf: onDate.toISOString(),
    functionalCurrency: functional,
    groups,
  };
}
