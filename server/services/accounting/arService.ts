import {
  CreditNoteStatus,
  CurrencyCode,
  InvoiceStatus,
  JournalStatus,
  PaymentStatus,
  Prisma,
  TaxClassification,
  TaxKind,
} from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';
import { ZERO, dec, money, mul, toBase } from './money';
import { postJournalInTransaction } from './journal';
import { getAccountingProfile, requireMappedAccount } from './context';
import {
  findTaxCode,
  recordTaxTransaction,
  resolveTaxCode,
  ruleSnapshot,
  taxAmountFor,
} from './taxService';
import { emitDomainEvent } from './audit';

/**
 * Accounts-receivable subledger.
 *
 * All AR activity debits or credits the single configured AR control account;
 * the customer and invoice detail lives in the subledger, never in extra GL
 * accounts. Every function here is:
 *   - tenant-scoped (no id is trusted without an organization check),
 *   - idempotent (posting twice returns the first journal),
 *   - atomic (the document update and the GL journal commit together).
 *
 * Posting an invoice does NOT transmit anything to eTIMS. `POSTED` is an
 * accounting state; eTIMS acceptance is a separate Phase 6 concern and is never
 * implied by this module.
 */

export interface InvoicePostingResult {
  created: boolean;
  journal: {
    id: string;
    entryNumber: string;
    status: JournalStatus;
    totalDebit: Prisma.Decimal;
    totalCredit: Prisma.Decimal;
  };
  invoice: {
    id: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  };
}

function taxKindForClassification(classification: TaxClassification): TaxKind {
  switch (classification) {
    case TaxClassification.ZERO_RATED:
      return TaxKind.VAT_ZERO;
    case TaxClassification.EXEMPT:
      return TaxKind.VAT_EXEMPT;
    case TaxClassification.WITHHOLDING:
      return TaxKind.NONE;
    case TaxClassification.STANDARD_16:
    default:
      return TaxKind.VAT_STANDARD;
  }
}

const CODE_FOR_CLASSIFICATION: Partial<Record<TaxClassification, string>> = {
  [TaxClassification.STANDARD_16]: 'KE-VAT-STD',
  [TaxClassification.ZERO_RATED]: 'KE-VAT-ZERO',
  [TaxClassification.EXEMPT]: 'KE-VAT-EXEMPT',
};

/**
 * Resolve the sales tax rule for a line.
 *
 * Prefers the organization's conventional code for the classification, then any
 * active rule of the matching kind. A non-VAT-registered organization is
 * treated as charging no VAT regardless of the product's classification.
 */
async function resolveSalesRule(
  tx: Prisma.TransactionClient,
  organizationId: string,
  classification: TaxClassification,
  onDate: Date,
  vatRegistered: boolean
) {
  if (!vatRegistered) return null;

  const kind = taxKindForClassification(classification);
  if (kind === TaxKind.NONE) return null;

  const conventional = CODE_FOR_CLASSIFICATION[classification];
  if (conventional) {
    const byCode = await findTaxCode(tx, organizationId, { code: conventional }, onDate, 'SALES');
    if (byCode) return byCode;
  }

  return tx.taxCode.findFirst({
    where: {
      organizationId,
      isActive: true,
      kind,
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
}

function statusFromPaid(total: Prisma.Decimal, paid: Prisma.Decimal): InvoiceStatus {
  if (paid.greaterThanOrEqualTo(total)) return InvoiceStatus.PAID;
  if (paid.greaterThan(0)) return InvoiceStatus.PARTIALLY_PAID;
  return InvoiceStatus.POSTED;
}

/**
 * Post a sales invoice to the ledger.
 *
 * DR accounts receivable (total)
 * CR revenue (net, per line's net amount)
 * CR VAT output (per tax rule's own GL account)
 */
export async function postSalesInvoice(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    invoiceId: string;
    userId?: string | null;
    ipAddress?: string | null;
    correlationId?: string | null;
  }
): Promise<InvoicePostingResult> {
  const invoice = await tx.salesInvoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.organizationId },
    include: { items: true },
  });

  if (!invoice) throw new AppError(404, 'NOT_FOUND', 'Sales invoice not found');

  if (invoice.status === InvoiceStatus.CANCELLED) {
    throw new AppError(409, 'INVOICE_CANCELLED', 'A cancelled invoice cannot be posted');
  }

  if (invoice.postedJournalId) {
    const existing = await tx.journalEntry.findUnique({
      where: { id: invoice.postedJournalId },
      include: { lines: true },
    });
    if (existing) {
      return {
        created: false,
        journal: {
          id: existing.id,
          entryNumber: existing.entryNumber,
          status: existing.status,
          totalDebit: existing.lines.reduce((acc, l) => acc.plus(l.debit), ZERO),
          totalCredit: existing.lines.reduce((acc, l) => acc.plus(l.credit), ZERO),
        },
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          subtotal: invoice.subtotal,
          taxAmount: invoice.taxAmount,
          totalAmount: invoice.totalAmount,
        },
      };
    }
  }

  if (invoice.items.length === 0) {
    throw new AppError(400, 'INVOICE_HAS_NO_LINES', 'An invoice must have at least one line before posting');
  }

  const profile = await getAccountingProfile(tx, input.organizationId);
  const arAccount = await requireMappedAccount(tx, input.organizationId, 'arControlAccountId');
  const revenueAccount = await requireMappedAccount(tx, input.organizationId, 'defaultRevenueAccountId');

  const exchangeRate = dec(invoice.exchangeRate);
  if (exchangeRate.lessThanOrEqualTo(0)) {
    throw new AppError(400, 'INVALID_EXCHANGE_RATE', 'Invoice exchange rate must be greater than zero');
  }

  let netTotal = ZERO;
  let taxTotal = ZERO;
  const taxByAccount = new Map<string, Prisma.Decimal>();
  const taxByRule = new Map<
    string,
    { rule: NonNullable<Awaited<ReturnType<typeof resolveSalesRule>>>; base: Prisma.Decimal; tax: Prisma.Decimal }
  >();

  for (const item of invoice.items) {
    const net = money(mul(item.quantity, item.unitPrice));
    netTotal = netTotal.plus(net);

    const rule = await resolveSalesRule(
      tx,
      input.organizationId,
      item.taxClassification,
      invoice.invoiceDate,
      profile.isVatRegistered
    );

    const tax = rule ? taxAmountFor(net, rule.ratePercent) : ZERO;
    taxTotal = taxTotal.plus(tax);

    // The rule is authoritative. If the stored line disagrees (for example a
    // product was reclassified after the invoice was drafted), correct the line
    // rather than posting a figure the tax engine cannot justify.
    if (!money(item.taxAmount).equals(tax)) {
      await tx.salesInvoiceItem.update({
        where: { id: item.id },
        data: { taxAmount: tax, lineTotal: net.plus(tax) },
      });
    }

    if (rule && tax.greaterThan(0)) {
      const accountId =
        rule.glOutputAccountId ??
        (await requireMappedAccount(tx, input.organizationId, 'vatOutputAccountId')).id;
      taxByAccount.set(accountId, (taxByAccount.get(accountId) ?? ZERO).plus(tax));

      const key = `${rule.id}:${rule.ratePercent.toString()}`;
      const bucket = taxByRule.get(key) ?? { rule, base: ZERO, tax: ZERO };
      bucket.base = bucket.base.plus(net);
      bucket.tax = bucket.tax.plus(tax);
      taxByRule.set(key, bucket);
    }
  }

  const total = netTotal.plus(taxTotal);

  if (!total.greaterThan(0)) {
    throw new AppError(400, 'INVOICE_ZERO_VALUE', 'An invoice with a zero total cannot be posted');
  }

  const lines = [
    {
      accountId: arAccount.id,
      description: `Receivable: invoice ${invoice.invoiceNumber}`,
      debit: total,
    },
    ...(netTotal.greaterThan(0)
      ? [
          {
            accountId: revenueAccount.id,
            description: `Revenue: invoice ${invoice.invoiceNumber}`,
            credit: netTotal,
          },
        ]
      : []),
    ...Array.from(taxByAccount.entries()).map(([accountId, amount]) => ({
      accountId,
      description: `VAT output: invoice ${invoice.invoiceNumber}`,
      credit: amount,
    })),
  ];

  const result = await postJournalInTransaction(tx, {
    organizationId: input.organizationId,
    branchId: invoice.branchId,
    postingDate: invoice.invoiceDate,
    description: `Sales invoice ${invoice.invoiceNumber}`,
    sourceModule: 'SALES_INVOICE',
    sourceId: invoice.id,
    sourceKey: `sales-invoice:${invoice.id}`,
    transactionRef: invoice.invoiceNumber,
    currency: invoice.currency,
    exchangeRate,
    status: 'POSTED',
    allowControlAccounts: true,
    createdBy: input.userId ?? null,
    postedBy: input.userId ?? null,
    ipAddress: input.ipAddress ?? null,
    correlationId: input.correlationId ?? null,
    lines,
  });

  const nextStatus = statusFromPaid(total, dec(invoice.paidAmount));

  const updated = await tx.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      subtotal: netTotal,
      taxAmount: taxTotal,
      totalAmount: total,
      status: nextStatus,
      postedJournalId: result.journal.id,
      journalPostedAt: new Date(),
      taxSnapshotJson: JSON.stringify(
        Array.from(taxByRule.values()).map((b) => ruleSnapshot(b.rule, b.tax))
      ),
    },
  });

  for (const bucket of taxByRule.values()) {
    await recordTaxTransaction(tx, {
      organizationId: input.organizationId,
      rule: bucket.rule,
      sourceType: 'SALES_INVOICE',
      sourceId: invoice.id,
      taxableBase: bucket.base,
      taxAmount: bucket.tax,
      currency: invoice.currency,
    });
  }

  await emitDomainEvent(tx, {
    organizationId: input.organizationId,
    eventType: 'invoice.posted',
    aggregateType: 'SalesInvoice',
    aggregateId: invoice.id,
    payload: {
      invoiceNumber: invoice.invoiceNumber,
      total: total.toFixed(2),
      currency: invoice.currency,
      journalEntryNumber: result.journal.entryNumber,
      // Explicit: accounting posting says nothing about eTIMS acceptance.
      etims: 'NOT_TRANSMITTED',
    },
  });

  return {
    created: result.created,
    journal: {
      id: result.journal.id,
      entryNumber: result.journal.entryNumber,
      status: result.journal.status,
      totalDebit: result.journal.totalDebit,
      totalCredit: result.journal.totalCredit,
    },
    invoice: {
      id: updated.id,
      invoiceNumber: updated.invoiceNumber,
      status: updated.status,
      subtotal: updated.subtotal,
      taxAmount: updated.taxAmount,
      totalAmount: updated.totalAmount,
    },
  };
}

/**
 * Post a customer receipt.
 *
 * DR bank / cash (amount received)
 * CR accounts receivable (amount received)
 *
 * Unapplied cash is a legitimate state: the credit sits in AR until it is
 * allocated to an invoice, which is why `SalesInvoice.salesInvoiceId` was made
 * nullable and `PaymentAllocation` exists.
 */
export async function postCustomerPayment(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    paymentId: string;
    userId?: string | null;
    ipAddress?: string | null;
    correlationId?: string | null;
  }
) {
  const payment = await tx.customerPayment.findFirst({
    where: { id: input.paymentId, organizationId: input.organizationId },
  });

  if (!payment) throw new AppError(404, 'NOT_FOUND', 'Customer payment not found');
  if (payment.status === PaymentStatus.REVERSED) {
    throw new AppError(409, 'PAYMENT_REVERSED', 'A reversed payment cannot be posted');
  }

  if (payment.postedJournalId) {
    const existing = await tx.journalEntry.findUnique({
      where: { id: payment.postedJournalId },
      include: { lines: true },
    });
    if (existing) {
      return {
        created: false,
        journal: existing,
        payment,
      };
    }
  }

  const amount = money(payment.amount);
  if (!amount.greaterThan(0)) {
    throw new AppError(400, 'INVALID_AMOUNT', 'A payment amount must be greater than zero');
  }

  let depositAccountId: string;

  if (payment.bankAccountId) {
    const bank = await tx.bankAccount.findFirst({
      where: { id: payment.bankAccountId, organizationId: input.organizationId },
      include: { glAccount: { select: { id: true, accountNumber: true, name: true, isActive: true } } },
    });
    if (!bank) throw new AppError(404, 'NOT_FOUND', 'Bank account not found');
    if (!bank.glAccount.isActive) {
      throw new AppError(400, 'ACCOUNT_INACTIVE', `GL account ${bank.glAccount.accountNumber} is inactive`);
    }
    depositAccountId = bank.glAccountId;
  } else {
    const cash = await requireMappedAccount(tx, input.organizationId, 'defaultCashAccountId');
    depositAccountId = cash.id;
  }

  const arAccount = await requireMappedAccount(tx, input.organizationId, 'arControlAccountId');

  const result = await postJournalInTransaction(tx, {
    organizationId: input.organizationId,
    branchId: payment.branchId ?? null,
    postingDate: payment.paymentDate,
    description: `Customer receipt ${payment.paymentNumber} (${payment.paymentMethod})`,
    sourceModule: 'CUSTOMER_PAYMENT',
    sourceId: payment.id,
    sourceKey: `customer-payment:${payment.id}`,
    transactionRef: payment.referenceCode,
    currency: payment.currency,
    exchangeRate: payment.exchangeRate,
    status: 'POSTED',
    allowControlAccounts: true,
    createdBy: payment.createdBy ?? input.userId ?? null,
    postedBy: input.userId ?? null,
    ipAddress: input.ipAddress ?? null,
    correlationId: input.correlationId ?? null,
    lines: [
      { accountId: depositAccountId, description: `Receipt ${payment.referenceCode}`, debit: amount },
      { accountId: arAccount.id, description: `Receivable settled: ${payment.referenceCode}`, credit: amount },
    ],
  });

  const updated = await tx.customerPayment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.POSTED,
      postedJournalId: result.journal.id,
      postedAt: new Date(),
      unappliedAmount: payment.unappliedAmount.equals(0) ? amount : payment.unappliedAmount,
    },
  });

  await emitDomainEvent(tx, {
    organizationId: input.organizationId,
    eventType: 'payment.posted',
    aggregateType: 'CustomerPayment',
    aggregateId: payment.id,
    payload: {
      paymentNumber: payment.paymentNumber,
      amount: amount.toFixed(2),
      method: payment.paymentMethod,
      journalEntryNumber: result.journal.entryNumber,
    },
  });

  return { created: result.created, journal: result.journal, payment: updated };
}

export interface AllocationInput {
  invoiceId: string;
  amount: Prisma.Decimal | string | number;
}

/**
 * Allocate a posted receipt to one or more invoices.
 *
 * Rejects over-allocation at both levels: a receipt cannot allocate more than it
 * received, and a line cannot allocate more than the invoice still owes. This
 * closes the pre-Phase-4 defect where the API accepted an allocation larger than
 * the invoice balance.
 */
export async function allocateCustomerPayment(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    paymentId: string;
    allocations: AllocationInput[];
    userId?: string | null;
    ipAddress?: string | null;
  }
) {
  const payment = await tx.customerPayment.findFirst({
    where: { id: input.paymentId, organizationId: input.organizationId },
    include: { allocations: true },
  });

  if (!payment) throw new AppError(404, 'NOT_FOUND', 'Customer payment not found');
  if (!payment.postedJournalId || payment.status === PaymentStatus.DRAFT) {
    throw new AppError(409, 'PAYMENT_NOT_POSTED', 'Post the receipt before allocating it');
  }
  if (payment.status === PaymentStatus.REVERSED) {
    throw new AppError(409, 'PAYMENT_REVERSED', 'A reversed receipt cannot be allocated');
  }
  if (input.allocations.length === 0) {
    throw new AppError(400, 'NO_ALLOCATIONS', 'At least one allocation is required');
  }

  const alreadyAllocated = payment.allocations.reduce((acc, a) => acc.plus(a.amount), ZERO);
  const available = money(payment.amount).minus(alreadyAllocated);

  let requested = ZERO;
  for (const allocation of input.allocations) {
    const amount = money(allocation.amount);
    if (!amount.greaterThan(0)) {
      throw new AppError(400, 'INVALID_ALLOCATION', 'An allocation amount must be greater than zero');
    }
    requested = requested.plus(amount);
  }

  if (requested.greaterThan(available)) {
    throw new AppError(
      400,
      'OVER_ALLOCATION',
      'Allocations exceed the unapplied balance of this receipt',
      { available: available.toFixed(2), requested: requested.toFixed(2) }
    );
  }

  const duplicates = new Set<string>();
  for (const allocation of input.allocations) {
    if (duplicates.has(allocation.invoiceId)) {
      throw new AppError(400, 'DUPLICATE_ALLOCATION', 'The same invoice appears twice in one allocation request');
    }
    duplicates.add(allocation.invoiceId);
  }

  const profile = await getAccountingProfile(tx, input.organizationId);
  const results: Array<{ invoiceId: string; invoiceNumber: string; allocated: string; status: InvoiceStatus }> = [];

  for (const allocation of input.allocations) {
    const amount = money(allocation.amount);

    const invoice = await tx.salesInvoice.findFirst({
      where: { id: allocation.invoiceId, organizationId: input.organizationId },
    });

    if (!invoice) throw new AppError(404, 'NOT_FOUND', `Invoice ${allocation.invoiceId} not found`);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new AppError(409, 'INVOICE_CANCELLED', `Invoice ${invoice.invoiceNumber} is cancelled`);
    }
    if (payment.customerId && invoice.customerId !== payment.customerId) {
      throw new AppError(
        400,
        'CUSTOMER_MISMATCH',
        `Receipt and invoice ${invoice.invoiceNumber} belong to different customers`
      );
    }
    if (invoice.currency !== payment.currency) {
      throw new AppError(
        400,
        'CURRENCY_MISMATCH',
        `Invoice ${invoice.invoiceNumber} is in ${invoice.currency}; receipt is in ${payment.currency}`
      );
    }

    const outstanding = money(invoice.totalAmount).minus(invoice.paidAmount);
    if (amount.greaterThan(outstanding)) {
      throw new AppError(
        400,
        'OVER_ALLOCATION',
        `Allocation exceeds the outstanding balance of invoice ${invoice.invoiceNumber}`,
        { invoiceId: invoice.id, outstanding: outstanding.toFixed(2), requested: amount.toFixed(2) }
      );
    }

    const existing = await tx.paymentAllocation.findUnique({
      where: { paymentId_salesInvoiceId: { paymentId: payment.id, salesInvoiceId: invoice.id } },
    });
    if (existing) {
      throw new AppError(
        409,
        'ALREADY_ALLOCATED',
        `This receipt is already allocated to invoice ${invoice.invoiceNumber}`
      );
    }

    await tx.paymentAllocation.create({
      data: {
        organizationId: input.organizationId,
        paymentId: payment.id,
        salesInvoiceId: invoice.id,
        amount,
        createdBy: input.userId ?? null,
      },
    });

    const newPaid = money(invoice.paidAmount).plus(amount);
    const updatedInvoice = await tx.salesInvoice.update({
      where: { id: invoice.id },
      data: { paidAmount: newPaid, status: statusFromPaid(invoice.totalAmount, newPaid) },
    });

    // Realized FX: AR is relieved at the invoice rate, cash arrives at the
    // receipt rate. The difference is a real gain or loss and must be booked.
    if (invoice.currency !== profile.functionalCurrency) {
      const invoiceRate = dec(invoice.exchangeRate);
      const paymentRate = dec(payment.exchangeRate);

      if (!invoiceRate.equals(paymentRate)) {
        const arBase = toBase(amount, invoiceRate);
        const cashBase = toBase(amount, paymentRate);
        const difference = money(cashBase.minus(arBase));

        if (!difference.isZero()) {
          const arControl = await requireMappedAccount(tx, input.organizationId, 'arControlAccountId');
          const isGain = difference.greaterThan(0);
          const fxAccount = await requireMappedAccount(
            tx,
            input.organizationId,
            isGain ? 'fxGainAccountId' : 'fxLossAccountId'
          );
          const absolute = isGain ? difference : difference.negated();

          await postJournalInTransaction(tx, {
            organizationId: input.organizationId,
            branchId: invoice.branchId,
            postingDate: payment.paymentDate,
            description: `Realized FX on ${invoice.invoiceNumber} settled by ${payment.paymentNumber}`,
            sourceModule: 'FX_REALIZED',
            sourceId: invoice.id,
            sourceKey: `fx-realized:${payment.id}:${invoice.id}`,
            currency: profile.functionalCurrency,
            exchangeRate: 1,
            status: 'POSTED',
            allowControlAccounts: true,
            createdBy: input.userId ?? null,
            postedBy: input.userId ?? null,
            lines: isGain
              ? [
                  { accountId: arControl.id, description: 'AR correction at invoice rate', debit: absolute },
                  { accountId: fxAccount.id, description: 'Realized foreign-exchange gain', credit: absolute },
                ]
              : [
                  { accountId: fxAccount.id, description: 'Realized foreign-exchange loss', debit: absolute },
                  { accountId: arControl.id, description: 'AR correction at invoice rate', credit: absolute },
                ],
          });
        }
      }
    }

    results.push({
      invoiceId: updatedInvoice.id,
      invoiceNumber: updatedInvoice.invoiceNumber,
      allocated: amount.toFixed(2),
      status: updatedInvoice.status,
    });
  }

  const totalAllocated = alreadyAllocated.plus(requested);
  const updatedPayment = await tx.customerPayment.update({
    where: { id: payment.id },
    data: {
      unappliedAmount: money(payment.amount).minus(totalAllocated),
      status: totalAllocated.greaterThanOrEqualTo(payment.amount)
        ? PaymentStatus.FULLY_ALLOCATED
        : PaymentStatus.PARTIALLY_ALLOCATED,
    },
  });

  await emitDomainEvent(tx, {
    organizationId: input.organizationId,
    eventType: 'payment.allocated',
    aggregateType: 'CustomerPayment',
    aggregateId: payment.id,
    payload: {
      paymentNumber: payment.paymentNumber,
      totalAllocated: totalAllocated.toFixed(2),
      invoices: results.map((r) => r.invoiceNumber),
    },
  });

  return { payment: updatedPayment, allocations: results };
}

/**
 * Post a credit note.
 *
 * DR revenue (net)
 * DR VAT output (tax)
 * CR accounts receivable (total)
 */
export async function postCreditNote(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    creditNoteId: string;
    userId?: string | null;
    ipAddress?: string | null;
    correlationId?: string | null;
  }
) {
  const creditNote = await tx.creditNote.findFirst({
    where: { id: input.creditNoteId, organizationId: input.organizationId },
    include: { salesInvoice: { select: { id: true, invoiceNumber: true, branchId: true } } },
  });

  if (!creditNote) throw new AppError(404, 'NOT_FOUND', 'Credit note not found');
  if (creditNote.status === CreditNoteStatus.CANCELLED) {
    throw new AppError(409, 'CREDIT_NOTE_CANCELLED', 'A cancelled credit note cannot be posted');
  }

  if (creditNote.postedJournalId) {
    const existing = await tx.journalEntry.findUnique({
      where: { id: creditNote.postedJournalId },
      include: { lines: true },
    });
    if (existing) return { created: false, journal: existing, creditNote };
  }

  const total = money(creditNote.totalAmount);
  const tax = money(creditNote.taxAmount);
  const subtotal = creditNote.subtotal.greaterThan(0)
    ? money(creditNote.subtotal)
    : total.minus(tax);

  if (!total.greaterThan(0)) {
    throw new AppError(400, 'INVALID_AMOUNT', 'A credit note total must be greater than zero');
  }

  const arAccount = await requireMappedAccount(tx, input.organizationId, 'arControlAccountId');
  const revenueAccount = await requireMappedAccount(tx, input.organizationId, 'defaultRevenueAccountId');

  const lines = [
    ...(subtotal.greaterThan(0)
      ? [{ accountId: revenueAccount.id, description: `Revenue reversal: ${creditNote.creditNoteNumber}`, debit: subtotal }]
      : []),
    ...(tax.greaterThan(0)
      ? [
          {
            accountId: (await requireMappedAccount(tx, input.organizationId, 'vatOutputAccountId')).id,
            description: `VAT output reversal: ${creditNote.creditNoteNumber}`,
            debit: tax,
          },
        ]
      : []),
    { accountId: arAccount.id, description: `Receivable credit: ${creditNote.creditNoteNumber}`, credit: total },
  ];

  const result = await postJournalInTransaction(tx, {
    organizationId: input.organizationId,
    branchId: creditNote.branchId ?? creditNote.salesInvoice.branchId,
    postingDate: creditNote.issuedAt,
    description: `Credit note ${creditNote.creditNoteNumber} against ${creditNote.salesInvoice.invoiceNumber}`,
    sourceModule: 'CREDIT_NOTE',
    sourceId: creditNote.id,
    sourceKey: `credit-note:${creditNote.id}`,
    transactionRef: creditNote.salesInvoice.invoiceNumber,
    currency: creditNote.currency,
    exchangeRate: creditNote.exchangeRate,
    status: 'POSTED',
    allowControlAccounts: true,
    createdBy: creditNote.createdBy ?? input.userId ?? null,
    postedBy: input.userId ?? null,
    ipAddress: input.ipAddress ?? null,
    correlationId: input.correlationId ?? null,
    lines,
  });

  const updated = await tx.creditNote.update({
    where: { id: creditNote.id },
    data: {
      status: CreditNoteStatus.POSTED,
      postedJournalId: result.journal.id,
      postedAt: new Date(),
    },
  });

  await emitDomainEvent(tx, {
    organizationId: input.organizationId,
    eventType: 'credit-note.posted',
    aggregateType: 'CreditNote',
    aggregateId: creditNote.id,
    payload: {
      creditNoteNumber: creditNote.creditNoteNumber,
      invoiceNumber: creditNote.salesInvoice.invoiceNumber,
      total: total.toFixed(2),
      journalEntryNumber: result.journal.entryNumber,
    },
  });

  return { created: result.created, journal: result.journal, creditNote: updated };
}
