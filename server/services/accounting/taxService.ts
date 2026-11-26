import {
  CurrencyCode,
  Prisma,
  TaxApplicability,
  TaxCode,
  TaxKind,
} from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';
import { MoneyInput, dec, money, percentOf } from './money';

/**
 * Effective-dated tax rules.
 *
 * Kenya's VAT and withholding-tax rates are statutory and change with Finance
 * Acts, so a rate must never be a literal in posting code. Every rate lives in
 * `TaxCode` with an `effectiveFrom`/`effectiveTo` window, a legal reference and
 * a version, and every posted document snapshots the exact rule it used into
 * `TaxTransaction`. Re-running a report or reversing a document in 2031 must
 * reproduce the 2026 calculation, not today's rate.
 *
 * Nothing in this module contains a statutory percentage. `seedKenyanVatCodes`
 * inserts the well-known VAT categories as *data* with legal references so a
 * new organization can post immediately; finance can supersede any of them with
 * a new effective-dated row.
 */

export interface TaxSelector {
  taxCodeId?: string | null;
  code?: string | null;
}

export interface TaxRuleSnapshot {
  taxCodeId: string;
  code: string;
  name: string;
  kind: TaxKind;
  ratePercent: string;
  applicability: TaxApplicability;
  effectiveFrom: string;
  effectiveTo: string | null;
  legalRef: string | null;
  reverseCharge: boolean;
  isRecoverable: boolean;
}

function applicabilityFor(
  side: 'SALES' | 'PURCHASE' | undefined
): TaxApplicability[] | undefined {
  if (!side) return undefined;
  return side === 'SALES'
    ? [TaxApplicability.SALES, TaxApplicability.BOTH]
    : [TaxApplicability.PURCHASE, TaxApplicability.BOTH];
}

/**
 * Resolve the tax rule in force on `onDate`.
 *
 * Resolution is by id or by code. When a code is reused over time (a rate
 * change), the row whose effective window contains `onDate` wins; a future row
 * is never selected early and a superseded row is never selected late.
 */
export async function resolveTaxCode(
  tx: Prisma.TransactionClient,
  organizationId: string,
  selector: TaxSelector,
  onDate: Date,
  side?: 'SALES' | 'PURCHASE'
): Promise<TaxCode> {
  if (Number.isNaN(onDate.getTime())) {
    throw new AppError(400, 'INVALID_DATE', 'A valid document date is required to resolve tax');
  }
  if (!selector.taxCodeId && !selector.code) {
    throw new AppError(400, 'TAX_CODE_REQUIRED', 'A tax code is required');
  }

  const applicability = applicabilityFor(side);

  const where: Prisma.TaxCodeWhereInput = {
    organizationId,
    isActive: true,
    effectiveFrom: { lte: onDate },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    ...(applicability ? { applicability: { in: applicability } } : {}),
    ...(selector.taxCodeId ? { id: selector.taxCodeId } : { code: selector.code! }),
  };

  const rule = await tx.taxCode.findFirst({
    where,
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });

  if (!rule) {
    throw new AppError(
      400,
      'TAX_RULE_NOT_FOUND',
      `No active tax rule matches ${
        selector.code ?? selector.taxCodeId
      } on ${onDate.toISOString().slice(0, 10)}`,
      { selector, onDate: onDate.toISOString() }
    );
  }

  return rule;
}

/** Optional variant used where a missing rule simply means "no tax". */
export async function findTaxCode(
  tx: Prisma.TransactionClient,
  organizationId: string,
  selector: TaxSelector,
  onDate: Date,
  side?: 'SALES' | 'PURCHASE'
): Promise<TaxCode | null> {
  try {
    return await resolveTaxCode(tx, organizationId, selector, onDate, side);
  } catch (error) {
    if (error instanceof AppError && error.code === 'TAX_RULE_NOT_FOUND') return null;
    throw error;
  }
}

export function taxAmountFor(base: MoneyInput, ratePercent: MoneyInput): Prisma.Decimal {
  return percentOf(base, ratePercent);
}

/** Snapshot the rule that produced a posted tax amount. */
export function ruleSnapshot(rule: TaxCode, taxAmount: Prisma.Decimal): TaxRuleSnapshot & {
  taxAmount: string;
} {
  return {
    taxCodeId: rule.id,
    code: rule.code,
    name: rule.name,
    kind: rule.kind,
    ratePercent: dec(rule.ratePercent).toFixed(4),
    applicability: rule.applicability,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString() : null,
    legalRef: rule.legalRef,
    reverseCharge: rule.reverseCharge,
    isRecoverable: rule.isRecoverable,
    taxAmount: money(taxAmount).toFixed(2),
  };
}

export interface RecordTaxInput {
  organizationId: string;
  rule: TaxCode;
  sourceType: 'SALES_INVOICE' | 'SUPPLIER_BILL' | 'CREDIT_NOTE' | 'JOURNAL' | 'SUPPLIER_PAYMENT';
  sourceId: string;
  taxableBase: MoneyInput;
  taxAmount: MoneyInput;
  currency?: CurrencyCode;
}

/**
 * Persist the tax calculation alongside the document it belongs to.
 * Written in the caller's transaction so a rolled-back invoice leaves no
 * orphaned tax row.
 */
export async function recordTaxTransaction(
  tx: Prisma.TransactionClient,
  input: RecordTaxInput
): Promise<void> {
  const taxableBase = money(input.taxableBase);
  const taxAmount = money(input.taxAmount);

  await tx.taxTransaction.create({
    data: {
      organizationId: input.organizationId,
      taxCodeId: input.rule.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      taxKind: input.rule.kind,
      taxableBase,
      ratePercent: input.rule.ratePercent,
      taxAmount,
      currency: input.currency ?? CurrencyCode.KES,
      effectiveFrom: input.rule.effectiveFrom,
      effectiveTo: input.rule.effectiveTo,
      ruleSnapshotJson: JSON.stringify(ruleSnapshot(input.rule, taxAmount)),
    },
  });
}

export interface VatSummaryRow {
  taxCodeId: string;
  code: string;
  name: string;
  kind: TaxKind;
  ratePercent: string;
  taxableBase: string;
  taxAmount: string;
}

/** VAT position for a date range, grouped by the rule actually applied. */
export async function vatSummary(
  tx: Prisma.TransactionClient,
  organizationId: string,
  from: Date,
  to: Date,
  options: { sourceTypes?: string[] } = {}
): Promise<{ output: VatSummaryRow[]; input: VatSummaryRow[]; netPayable: string }> {
  const rows = await tx.taxTransaction.findMany({
    where: {
      organizationId,
      createdAt: { gte: from, lte: to },
      ...(options.sourceTypes ? { sourceType: { in: options.sourceTypes } } : {}),
    },
    include: { taxCode: { select: { code: true, name: true } } },
  });

  const outputBucket = new Map<string, VatSummaryRow>();
  const inputBucket = new Map<string, VatSummaryRow>();

  const isVatKind = (kind: TaxKind) =>
    kind === TaxKind.VAT_STANDARD ||
    kind === TaxKind.VAT_ZERO ||
    kind === TaxKind.VAT_EXEMPT ||
    kind === TaxKind.VAT_REVERSE_CHARGE;

  for (const row of rows) {
    if (row.taxKind === TaxKind.NONE || !isVatKind(row.taxKind)) continue;
    const isPurchase = row.sourceType === 'SUPPLIER_BILL';
    const targetBucket = isPurchase ? inputBucket : outputBucket;
    const key = `${row.taxCodeId}:${row.ratePercent.toString()}`;
    const existing = targetBucket.get(key);
    const base = money(row.taxableBase);
    const amount = money(row.taxAmount);

    if (existing) {
      existing.taxableBase = money(existing.taxableBase).plus(base).toFixed(2);
      existing.taxAmount = money(existing.taxAmount).plus(amount).toFixed(2);
    } else {
      targetBucket.set(key, {
        taxCodeId: row.taxCodeId,
        code: row.taxCode.code,
        name: row.taxCode.name,
        kind: row.taxKind,
        ratePercent: dec(row.ratePercent).toFixed(4),
        taxableBase: base.toFixed(2),
        taxAmount: amount.toFixed(2),
      });
    }
  }

  const output = Array.from(outputBucket.values());
  const input = Array.from(inputBucket.values());

  const outputTotal = output.reduce((acc, r) => acc.plus(money(r.taxAmount)), new Prisma.Decimal(0));
  const inputTotal = input.reduce((acc, r) => acc.plus(money(r.taxAmount)), new Prisma.Decimal(0));

  return {
    output,
    input,
    netPayable: outputTotal.minus(inputTotal).toFixed(2),
  };
}

interface SeedVatCode {
  code: string;
  name: string;
  kind: TaxKind;
  ratePercent: string;
  legalRef: string;
  notes: string;
}

/**
 * VAT categories under the VAT Act 2013 (Kenya), seeded as editable data.
 *
 * The standard rate has been 16% since the Act commenced on 2 September 2013
 * (s.5(1)); zero-rating (s.7) and exemption (s.8) are 0% bands that still
 * require reporting. These rows carry a legal reference so an auditor can trace
 * them, and an organization may supersede any of them with an effective-dated
 * row when the law changes.
 */
const KENYAN_VAT_CATALOG: SeedVatCode[] = [
  {
    code: 'KE-VAT-STD',
    name: 'Kenya VAT — standard rate',
    kind: TaxKind.VAT_STANDARD,
    ratePercent: '16.0000',
    legalRef: 'VAT Act 2013 s.5(1)',
    notes: 'Standard-rated supply. Rate is data, not code: supersede with a new effective-dated row after a Finance Act change.',
  },
  {
    code: 'KE-VAT-ZERO',
    name: 'Kenya VAT — zero rated',
    kind: TaxKind.VAT_ZERO,
    ratePercent: '0.0000',
    legalRef: 'VAT Act 2013 s.7 (First Schedule)',
    notes: 'Zero-rated supply. Reportable at 0%.',
  },
  {
    code: 'KE-VAT-EXEMPT',
    name: 'Kenya VAT — exempt',
    kind: TaxKind.VAT_EXEMPT,
    ratePercent: '0.0000',
    legalRef: 'VAT Act 2013 s.8 (Second Schedule)',
    notes: 'Exempt supply. No VAT charged and no input credit attributable to it.',
  },
];

const VAT_COMMENCEMENT = new Date(Date.UTC(2013, 8, 2, 0, 0, 0, 0));

/**
 * Idempotently insert the Kenyan VAT catalogue for an organization.
 * Withholding-tax categories are deliberately NOT seeded: WHT rates differ by
 * payment type and residence, change with each Finance Act, and a wrong
 * statutory rate creates a real tax liability. Finance must enter them from the
 * current KRA schedule; the engine will then apply them like any other rule.
 */
export async function seedKenyanVatCodes(
  tx: Prisma.TransactionClient,
  organizationId: string,
  createdBy?: string | null
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const entry of KENYAN_VAT_CATALOG) {
    const found = await tx.taxCode.findUnique({
      where: {
        organizationId_code_effectiveFrom: {
          organizationId,
          code: entry.code,
          effectiveFrom: VAT_COMMENCEMENT,
        },
      },
    });

    if (found) {
      existing += 1;
      continue;
    }

    await tx.taxCode.create({
      data: {
        organizationId,
        code: entry.code,
        name: entry.name,
        kind: entry.kind,
        applicability: TaxApplicability.BOTH,
        ratePercent: entry.ratePercent,
        effectiveFrom: VAT_COMMENCEMENT,
        legalRef: entry.legalRef,
        notes: entry.notes,
        createdBy: createdBy ?? null,
      },
    });
    created += 1;
  }

  return { created, existing };
}
