import {
  CurrencyCode,
  PaymentStatus,
  Prisma,
  SupplierBillStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { AppError } from '../../middleware/errorHandler';
import { ZERO, dec, money } from './money';
import { postJournalInTransaction } from './journal';
import {
  getAccountingProfile,
  requireAccountInOrg,
  requireMappedAccount,
} from './context';
import { emitDomainEvent } from './audit';

/**
 * Accounts-payable subledger.
 *
 * Bills are the mirror of invoices but with three extra controls that the
 * pre-Phase-4 code lacked entirely: duplicate detection, input-VAT recovery and
 * withholding tax as a real liability to KRA rather than a silent reduction of
 * the expense.
 *
 * No bill is ever posted against a fabricated goods-receipt or purchase-order
 * reference: `goodsReceiptRef` is only ever whatever the caller supplied.
 */

export function supplierBillFingerprint(input: {
  supplierId: string;
  billNumber: string;
  billDate: Date | string;
  totalAmount: Prisma.Decimal | string | number;
}): string {
  const date = input.billDate instanceof Date ? input.billDate : new Date(input.billDate);
  return createHash('sha256')
    .update(
      [
        input.supplierId,
        input.billNumber.trim().toLowerCase(),
        date.toISOString().slice(0, 10),
        money(input.totalAmount).toFixed(2),
      ].join('|')
    )
    .digest('hex');
}

export async function postSupplierBill(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    billId: string;
    userId?: string | null;
    ipAddress?: string | null;
    correlationId?: string | null;
  }
) {
  const bill = await tx.supplierBill.findFirst({
    where: { id: input.billId, organizationId: input.organizationId },
    include: { lines: true },
  });

  if (!bill) throw new AppError(404, 'NOT_FOUND', 'Supplier bill not found');
  if (bill.status === SupplierBillStatus.CANCELLED) {
    throw new AppError(409, 'BILL_CANCELLED', 'A cancelled bill cannot be posted');
  }

  if (bill.postedJournalId) {
    const existing = await tx.journalEntry.findUnique({
      where: { id: bill.postedJournalId },
      include: { lines: true },
    });
    if (existing) return { created: false, journal: existing, bill };
  }

  if (bill.lines.length === 0) {
    throw new AppError(400, 'BILL_HAS_NO_LINES', 'A supplier bill must have at least one line before posting');
  }

  // Duplicate control. The same supplier invoice must never hit the ledger twice,
  // whether it arrives through the API twice or through two import batches.
  const fingerprint =
    bill.duplicateHash ??
    supplierBillFingerprint({
      supplierId: bill.supplierId,
      billNumber: bill.billNumber,
      billDate: bill.billDate,
      totalAmount: bill.totalAmount,
    });

  const duplicate = await tx.supplierBill.findFirst({
    where: {
      organizationId: input.organizationId,
      duplicateHash: fingerprint,
      postedJournalId: { not: null },
      id: { not: bill.id },
    },
    select: { id: true, internalNumber: true },
  });

  if (duplicate) {
    throw new AppError(
      409,
      'DUPLICATE_SUPPLIER_BILL',
      `This supplier invoice is already posted as ${duplicate.internalNumber}`,
      { existingBillId: duplicate.id }
    );
  }

  const profile = await getAccountingProfile(tx, input.organizationId);
  const apAccount = await requireMappedAccount(tx, input.organizationId, 'apControlAccountId');
  const defaultExpense = await requireMappedAccount(tx, input.organizationId, 'defaultExpenseAccountId');

  let expenseTotal = ZERO;
  const expenseLines: Array<{
    accountId: string;
    description: string;
    debit: Prisma.Decimal;
    costCentreId?: string | null;
  }> = [];

  for (const line of bill.lines) {
    const account = await requireAccountInOrg(
      tx,
      input.organizationId,
      line.expenseAccountId,
      'expense account'
    );

    // Net of recoverable VAT: input VAT is a separate debit to the VAT input
    // control account, so the expense carries only the net amount.
    const net = money(line.lineTotal).minus(line.taxAmount);
    if (!net.greaterThanOrEqualTo(0)) {
      throw new AppError(400, 'INVALID_LINE', `Line "${line.description}" has tax greater than its total`);
    }

    expenseTotal = expenseTotal.plus(net);
    expenseLines.push({
      accountId: account.id ?? defaultExpense.id,
      description: line.description,
      debit: net,
      costCentreId: line.costCentreId,
    });
  }

  const taxAmount = money(bill.taxAmount);
  const whtAmount = money(bill.whtAmount);
  const totalAmount = money(bill.totalAmount);

  const recomputedTotal = expenseTotal.plus(taxAmount).minus(whtAmount);
  if (!recomputedTotal.equals(totalAmount)) {
    throw new AppError(
      400,
      'BILL_NOT_BALANCED',
      'Bill totals do not reconcile with its lines',
      {
        linesNet: expenseTotal.toFixed(2),
        tax: taxAmount.toFixed(2),
        wht: whtAmount.toFixed(2),
        expectedTotal: recomputedTotal.toFixed(2),
        storedTotal: totalAmount.toFixed(2),
      }
    );
  }

  const lines = [...expenseLines];

  // Input VAT is only recoverable for a VAT-registered organization.
  if (taxAmount.greaterThan(0) && profile.isVatRegistered) {
    const vatInput = await requireMappedAccount(tx, input.organizationId, 'vatInputAccountId');
    lines.push({
      accountId: vatInput.id,
      description: `Input VAT: ${bill.billNumber}`,
      debit: taxAmount,
    });
  } else if (taxAmount.greaterThan(0)) {
    // Not registered: the tax is part of the cost.
    lines.push({
      accountId: defaultExpense.id,
      description: `Non-recoverable VAT: ${bill.billNumber}`,
      debit: taxAmount,
    });
  }

  lines.push({
    accountId: apAccount.id,
    description: `Payable: ${bill.billNumber}`,
    debit: ZERO,
    credit: totalAmount,
  });

  if (whtAmount.greaterThan(0)) {
    const whtPayable = await requireMappedAccount(tx, input.organizationId, 'whtPayableAccountId');
    lines.push({
      accountId: whtPayable.id,
      description: `Withholding tax withheld: ${bill.billNumber}`,
      debit: ZERO,
      credit: whtAmount,
    });
  }

  const result = await postJournalInTransaction(tx, {
    organizationId: input.organizationId,
    branchId: bill.branchId,
    postingDate: bill.billDate,
    description: `Supplier bill ${bill.billNumber} (${bill.internalNumber})`,
    sourceModule: 'SUPPLIER_BILL',
    sourceId: bill.id,
    sourceKey: `supplier-bill:${bill.id}`,
    transactionRef: bill.billNumber,
    currency: bill.currency,
    exchangeRate: bill.exchangeRate,
    status: 'POSTED',
    allowControlAccounts: true,
    createdBy: input.userId ?? null,
    postedBy: input.userId ?? null,
    ipAddress: input.ipAddress ?? null,
    correlationId: input.correlationId ?? null,
    lines,
  });

  const updated = await tx.supplierBill.update({
    where: { id: bill.id },
    data: {
      status: SupplierBillStatus.POSTED,
      postedJournalId: result.journal.id,
      duplicateHash: fingerprint,
    },
  });

  await emitDomainEvent(tx, {
    organizationId: input.organizationId,
    eventType: 'supplier-bill.posted',
    aggregateType: 'SupplierBill',
    aggregateId: bill.id,
    payload: {
      internalNumber: bill.internalNumber,
      billNumber: bill.billNumber,
      total: totalAmount.toFixed(2),
      journalEntryNumber: result.journal.entryNumber,
    },
  });

  return { created: result.created, journal: result.journal, bill: updated };
}

export async function postSupplierPayment(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    paymentId: string;
    userId?: string | null;
    ipAddress?: string | null;
    correlationId?: string | null;
  }
) {
  const payment = await tx.supplierPayment.findFirst({
    where: { id: input.paymentId, organizationId: input.organizationId },
  });

  if (!payment) throw new AppError(404, 'NOT_FOUND', 'Supplier payment not found');
  if (payment.status === PaymentStatus.REVERSED) {
    throw new AppError(409, 'PAYMENT_REVERSED', 'A reversed payment cannot be posted');
  }

  if (payment.postedJournalId) {
    const existing = await tx.journalEntry.findUnique({
      where: { id: payment.postedJournalId },
      include: { lines: true },
    });
    if (existing) return { created: false, journal: existing, payment };
  }

  const amount = money(payment.amount);
  if (!amount.greaterThan(0)) {
    throw new AppError(400, 'INVALID_AMOUNT', 'A payment amount must be greater than zero');
  }

  let sourceAccountId: string;
  if (payment.bankAccountId) {
    const bank = await tx.bankAccount.findFirst({
      where: { id: payment.bankAccountId, organizationId: input.organizationId },
      include: { glAccount: { select: { id: true, isActive: true, accountNumber: true } } },
    });
    if (!bank) throw new AppError(404, 'NOT_FOUND', 'Bank account not found');
    if (!bank.glAccount.isActive) {
      throw new AppError(400, 'ACCOUNT_INACTIVE', `GL account ${bank.glAccount.accountNumber} is inactive`);
    }
    sourceAccountId = bank.glAccountId;
  } else {
    const cash = await requireMappedAccount(tx, input.organizationId, 'defaultCashAccountId');
    sourceAccountId = cash.id;
  }

  const apAccount = await requireMappedAccount(tx, input.organizationId, 'apControlAccountId');

  const result = await postJournalInTransaction(tx, {
    organizationId: input.organizationId,
    branchId: payment.branchId,
    postingDate: payment.paymentDate,
    description: `Supplier payment ${payment.paymentNumber} (${payment.paymentMethod})`,
    sourceModule: 'SUPPLIER_PAYMENT',
    sourceId: payment.id,
    sourceKey: `supplier-payment:${payment.id}`,
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
      { accountId: apAccount.id, description: `Payable settled: ${payment.referenceCode}`, debit: amount },
      { accountId: sourceAccountId, description: `Payment ${payment.referenceCode}`, credit: amount },
    ],
  });

  const updated = await tx.supplierPayment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.POSTED,
      postedJournalId: result.journal.id,
      unappliedAmount: payment.unappliedAmount.equals(0) ? amount : payment.unappliedAmount,
    },
  });

  await emitDomainEvent(tx, {
    organizationId: input.organizationId,
    eventType: 'supplier-payment.posted',
    aggregateType: 'SupplierPayment',
    aggregateId: payment.id,
    payload: {
      paymentNumber: payment.paymentNumber,
      amount: amount.toFixed(2),
      journalEntryNumber: result.journal.entryNumber,
    },
  });

  return { created: result.created, journal: result.journal, payment: updated };
}

function billStatusFromPaid(total: Prisma.Decimal, paid: Prisma.Decimal): SupplierBillStatus {
  if (paid.greaterThanOrEqualTo(total)) return SupplierBillStatus.PAID;
  if (paid.greaterThan(0)) return SupplierBillStatus.PARTIALLY_PAID;
  return SupplierBillStatus.POSTED;
}

export async function allocateSupplierPayment(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    paymentId: string;
    allocations: Array<{ billId: string; amount: Prisma.Decimal | string | number }>;
    userId?: string | null;
  }
) {
  const payment = await tx.supplierPayment.findFirst({
    where: { id: input.paymentId, organizationId: input.organizationId },
    include: { allocations: true },
  });

  if (!payment) throw new AppError(404, 'NOT_FOUND', 'Supplier payment not found');
  if (!payment.postedJournalId || payment.status === PaymentStatus.DRAFT) {
    throw new AppError(409, 'PAYMENT_NOT_POSTED', 'Post the payment before allocating it');
  }
  if (payment.status === PaymentStatus.REVERSED) {
    throw new AppError(409, 'PAYMENT_REVERSED', 'A reversed payment cannot be allocated');
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
    throw new AppError(400, 'OVER_ALLOCATION', 'Allocations exceed the unapplied balance of this payment', {
      available: available.toFixed(2),
      requested: requested.toFixed(2),
    });
  }

  const results: Array<{ billId: string; internalNumber: string; allocated: string; status: SupplierBillStatus }> = [];

  for (const allocation of input.allocations) {
    const amount = money(allocation.amount);

    const bill = await tx.supplierBill.findFirst({
      where: { id: allocation.billId, organizationId: input.organizationId },
    });

    if (!bill) throw new AppError(404, 'NOT_FOUND', `Bill ${allocation.billId} not found`);
    if (bill.status === SupplierBillStatus.CANCELLED) {
      throw new AppError(409, 'BILL_CANCELLED', `Bill ${bill.internalNumber} is cancelled`);
    }
    if (bill.supplierId !== payment.supplierId) {
      throw new AppError(400, 'SUPPLIER_MISMATCH', `Bill ${bill.internalNumber} belongs to another supplier`);
    }
    if (bill.currency !== payment.currency) {
      throw new AppError(
        400,
        'CURRENCY_MISMATCH',
        `Bill ${bill.internalNumber} is in ${bill.currency}; payment is in ${payment.currency}`
      );
    }

    const outstanding = money(bill.totalAmount).minus(bill.paidAmount);
    if (amount.greaterThan(outstanding)) {
      throw new AppError(
        400,
        'OVER_ALLOCATION',
        `Allocation exceeds the outstanding balance of bill ${bill.internalNumber}`,
        { billId: bill.id, outstanding: outstanding.toFixed(2), requested: amount.toFixed(2) }
      );
    }

    const existing = await tx.supplierPaymentAllocation.findUnique({
      where: {
        supplierPaymentId_supplierBillId: {
          supplierPaymentId: payment.id,
          supplierBillId: bill.id,
        },
      },
    });
    if (existing) {
      throw new AppError(409, 'ALREADY_ALLOCATED', `This payment is already allocated to ${bill.internalNumber}`);
    }

    await tx.supplierPaymentAllocation.create({
      data: {
        organizationId: input.organizationId,
        supplierPaymentId: payment.id,
        supplierBillId: bill.id,
        amount,
        createdBy: input.userId ?? null,
      },
    });

    const newPaid = money(bill.paidAmount).plus(amount);
    const updatedBill = await tx.supplierBill.update({
      where: { id: bill.id },
      data: { paidAmount: newPaid, status: billStatusFromPaid(bill.totalAmount, newPaid) },
    });

    results.push({
      billId: updatedBill.id,
      internalNumber: updatedBill.internalNumber,
      allocated: amount.toFixed(2),
      status: updatedBill.status,
    });
  }

  const totalAllocated = alreadyAllocated.plus(requested);
  const updatedPayment = await tx.supplierPayment.update({
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
    eventType: 'supplier-payment.allocated',
    aggregateType: 'SupplierPayment',
    aggregateId: payment.id,
    payload: {
      paymentNumber: payment.paymentNumber,
      totalAllocated: totalAllocated.toFixed(2),
      bills: results.map((r) => r.internalNumber),
    },
  });

  return { payment: updatedPayment, allocations: results };
}

/** AP ageing buckets computed from real open balances. */
export async function apAgeing(
  tx: Prisma.TransactionClient,
  organizationId: string,
  asOf: Date = new Date()
) {
  const bills = await tx.supplierBill.findMany({
    where: {
      organizationId,
      postedJournalId: { not: null },
      status: { notIn: [SupplierBillStatus.CANCELLED, SupplierBillStatus.PAID] },
    },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { dueDate: 'asc' },
  });

  const buckets = { current: ZERO, days30: ZERO, days60: ZERO, days90: ZERO, over90: ZERO };
  const rows: Array<{
    billId: string;
    internalNumber: string;
    supplier: string;
    dueDate: string;
    outstanding: string;
    daysOverdue: number;
    bucket: string;
  }> = [];

  for (const bill of bills) {
    const outstanding = money(bill.totalAmount).minus(bill.paidAmount);
    if (!outstanding.greaterThan(0)) continue;

    const daysOverdue = Math.floor(
      (asOf.getTime() - bill.dueDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    let bucket: keyof typeof buckets = 'current';
    if (daysOverdue > 90) bucket = 'over90';
    else if (daysOverdue > 60) bucket = 'days90';
    else if (daysOverdue > 30) bucket = 'days60';
    else if (daysOverdue > 0) bucket = 'days30';

    buckets[bucket] = buckets[bucket].plus(outstanding);

    rows.push({
      billId: bill.id,
      internalNumber: bill.internalNumber,
      supplier: bill.supplier.name,
      dueDate: bill.dueDate.toISOString().slice(0, 10),
      outstanding: outstanding.toFixed(2),
      daysOverdue,
      bucket,
    });
  }

  return {
    asOf: asOf.toISOString(),
    currency: CurrencyCode.KES,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.toFixed(2)])),
    total: Object.values(buckets).reduce((a, b) => a.plus(b), ZERO).toFixed(2),
    rows,
  };
}
