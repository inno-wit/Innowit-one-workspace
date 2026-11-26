import { createHash } from 'crypto';
import {
  BankAccountType,
  CurrencyCode,
  MpesaTransactionStatus,
  MpesaTransactionType,
  PaymentStatus,
  Prisma,
  ReconciliationMatchType,
  ReconciliationStatus,
  StatementLineStatus,
} from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';
import { ZERO, dec, money } from './money';
import { requireAccountInOrg } from './context';
import { emitDomainEvent } from './audit';

/**
 * Banking, statement reconciliation and the M-Pesa ledger.
 *
 * Two rules govern this module:
 *
 *  1. Nothing is fabricated. A statement line exists because a file said so; a
 *     match exists because an amount, a date and a reference actually agree. If
 *     a line is ambiguous it stays UNMATCHED and a human decides.
 *  2. A reconciliation is a signed statement about the ledger. It cannot be
 *     finalized while the bank and the GL disagree, and the person who prepared
 *     it cannot be the person who signs it off.
 */

export interface StatementLineInput {
  valueDate: Date | string;
  description: string;
  reference?: string | null;
  debit?: Prisma.Decimal | string | number;
  credit?: Prisma.Decimal | string | number;
  balanceAfter?: Prisma.Decimal | string | number | null;
}

function lineFingerprint(line: StatementLineInput, lineNumber: number): string {
  const date = line.valueDate instanceof Date ? line.valueDate : new Date(line.valueDate);
  return createHash('sha256')
    .update(
      [
        date.toISOString().slice(0, 10),
        money(line.debit ?? 0).toFixed(2),
        money(line.credit ?? 0).toFixed(2),
        (line.reference ?? '').trim(),
        line.description.trim(),
        String(lineNumber),
      ].join('|')
    )
    .digest('hex');
}

/** SHA-256 of an uploaded file, used to block duplicate statement imports. */
export function fileHash(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function createBankAccount(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    branchId?: string | null;
    name: string;
    type?: BankAccountType;
    accountNumber?: string | null;
    glAccountId: string;
    currency?: CurrencyCode;
    provider?: string | null;
    mpesaShortcode?: string | null;
    openingBalance?: Prisma.Decimal | string | number;
    openingDate?: Date | string | null;
  }
) {
  const glAccount = await requireAccountInOrg(tx, input.organizationId, input.glAccountId, 'bank GL account');

  if (glAccount.type !== 'ASSET') {
    throw new AppError(400, 'INVALID_BANK_GL_ACCOUNT', 'A bank account must map to an ASSET account');
  }

  return tx.bankAccount.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId ?? null,
      name: input.name,
      type: input.type ?? BankAccountType.BANK,
      accountNumber: input.accountNumber ?? null,
      glAccountId: glAccount.id,
      currency: input.currency ?? CurrencyCode.KES,
      provider: input.provider ?? null,
      mpesaShortcode: input.mpesaShortcode ?? null,
      openingBalance: money(input.openingBalance ?? 0),
      openingDate: input.openingDate ? new Date(input.openingDate) : null,
    },
  });
}

export async function importStatement(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    bankAccountId: string;
    fileName?: string | null;
    contentHash: string;
    format?: string;
    statementFrom: Date | string;
    statementTo: Date | string;
    openingBalance: Prisma.Decimal | string | number;
    closingBalance: Prisma.Decimal | string | number;
    lines: StatementLineInput[];
    importedBy?: string | null;
  }
) {
  const account = await tx.bankAccount.findFirst({
    where: { id: input.bankAccountId, organizationId: input.organizationId },
  });
  if (!account) throw new AppError(404, 'NOT_FOUND', 'Bank account not found');
  if (input.lines.length === 0) {
    throw new AppError(400, 'EMPTY_STATEMENT', 'A statement must contain at least one line');
  }

  const duplicate = await tx.bankStatement.findFirst({
    where: {
      organizationId: input.organizationId,
      bankAccountId: account.id,
      fileHash: input.contentHash,
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new AppError(409, 'DUPLICATE_STATEMENT', 'This statement file has already been imported', {
      statementId: duplicate.id,
    });
  }

  const prepared = input.lines.map((line, index) => {
    const debit = money(line.debit ?? 0);
    const credit = money(line.credit ?? 0);
    if (!debit.isZero() && !credit.isZero()) {
      throw new AppError(400, 'INVALID_STATEMENT_LINE', `Line ${index + 1} has both a debit and a credit`);
    }
    if (debit.isZero() && credit.isZero()) {
      throw new AppError(400, 'INVALID_STATEMENT_LINE', `Line ${index + 1} has no amount`);
    }

    return {
      lineNumber: index + 1,
      valueDate: line.valueDate instanceof Date ? line.valueDate : new Date(line.valueDate),
      description: line.description,
      reference: line.reference ?? null,
      debit,
      credit,
      balanceAfter: line.balanceAfter === null || line.balanceAfter === undefined ? null : money(line.balanceAfter),
      fingerprint: lineFingerprint(line, index + 1),
      status: StatementLineStatus.UNMATCHED,
    };
  });

  return tx.bankStatement.create({
    data: {
      organizationId: input.organizationId,
      bankAccountId: account.id,
      fileName: input.fileName ?? null,
      fileHash: input.contentHash,
      format: input.format ?? 'CSV',
      statementFrom: new Date(input.statementFrom),
      statementTo: new Date(input.statementTo),
      openingBalance: money(input.openingBalance),
      closingBalance: money(input.closingBalance),
      lineCount: prepared.length,
      importedBy: input.importedBy ?? null,
      lines: { create: prepared },
    },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
}

/**
 * Minimal, strict CSV statement parser: `date,description,reference,debit,credit`.
 * A header row is optional. Anything it cannot parse is an error the caller must
 * resolve, never a silently skipped row.
 */
export function parseStatementCsv(csv: string): StatementLineInput[] {
  const rows = csv
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  const lines: StatementLineInput[] = [];

  for (const [index, row] of rows.entries()) {
    const cells = row.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const date = new Date(cells[0]);

    if (Number.isNaN(date.getTime())) {
      if (index === 0) continue; // header row
      throw new AppError(400, 'INVALID_STATEMENT_CSV', `Row ${index + 1} does not start with a valid date`);
    }

    if (cells.length < 5) {
      throw new AppError(400, 'INVALID_STATEMENT_CSV', `Row ${index + 1} has fewer than 5 columns`);
    }

    lines.push({
      valueDate: date,
      description: cells[1] || 'Unlabelled transaction',
      reference: cells[2] || null,
      debit: cells[3] ? cells[3] : 0,
      credit: cells[4] ? cells[4] : 0,
    });
  }

  return lines;
}

/**
 * GL balance for a bank GL account up to a date, from posted journal lines.
 * Functional-currency amounts are used so a multi-currency bank account still
 * reconciles against the ledger.
 */
async function glBalanceUpTo(
  tx: Prisma.TransactionClient,
  organizationId: string,
  glAccountId: string,
  asOf: Date
): Promise<Prisma.Decimal> {
  const rows = await tx.$queryRaw<Array<{ balance: string | null }>>`
    SELECT COALESCE(SUM(l."baseDebit" - l."baseCredit"), 0)::text AS "balance"
    FROM "JournalLine" l
    JOIN "JournalEntry" j ON j."id" = l."journalEntryId"
    WHERE j."organizationId" = ${organizationId}
      AND l."accountId" = ${glAccountId}
      AND j."status" IN ('POSTED', 'REVERSED')
      AND j."postingDate" <= ${asOf}
  `;

  return dec(rows[0]?.balance ?? '0');
}

export async function startReconciliation(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    bankAccountId: string;
    statementId?: string | null;
    periodStart: Date | string;
    periodEnd: Date | string;
    statementClosingBalance: Prisma.Decimal | string | number;
    preparedBy?: string | null;
  }
) {
  const account = await tx.bankAccount.findFirst({
    where: { id: input.bankAccountId, organizationId: input.organizationId },
  });
  if (!account) throw new AppError(404, 'NOT_FOUND', 'Bank account not found');

  const periodEnd = new Date(input.periodEnd);
  const statementClosing = money(input.statementClosingBalance);
  const glClosing = await glBalanceUpTo(tx, input.organizationId, account.glAccountId, periodEnd);
  const difference = money(statementClosing.minus(glClosing));

  return tx.bankReconciliation.create({
    data: {
      organizationId: input.organizationId,
      bankAccountId: account.id,
      periodStart: new Date(input.periodStart),
      periodEnd,
      statementClosingBalance: statementClosing,
      glClosingBalance: glClosing,
      difference,
      status: ReconciliationStatus.DRAFT,
      preparedBy: input.preparedBy ?? null,
    },
  });
}

/**
 * Exact auto-matching.
 *
 * A statement line is matched only when exactly one posted receipt or payment
 * exists for the same amount, on the same bank account, within a five-day
 * window. Two candidates means ambiguity and the line stays unmatched.
 */
export async function autoMatch(tx: Prisma.TransactionClient, input: {
  organizationId: string;
  reconciliationId: string;
  userId?: string | null;
}) {
  const reconciliation = await tx.bankReconciliation.findFirst({
    where: { id: input.reconciliationId, organizationId: input.organizationId },
    include: { bankAccount: true },
  });

  if (!reconciliation) throw new AppError(404, 'NOT_FOUND', 'Reconciliation not found');
  if (reconciliation.status !== ReconciliationStatus.DRAFT) {
    throw new AppError(409, 'RECONCILIATION_CLOSED', 'Only a draft reconciliation can be matched');
  }

  const statements = await tx.bankStatement.findMany({
    where: {
      organizationId: input.organizationId,
      bankAccountId: reconciliation.bankAccountId,
      statementTo: { gte: reconciliation.periodStart },
      statementFrom: { lte: reconciliation.periodEnd },
    },
    include: {
      lines: { where: { status: StatementLineStatus.UNMATCHED } },
    },
  });

  let matched = 0;
  let unmatched = 0;

  const window = 5 * 24 * 60 * 60 * 1000;

  for (const statement of statements) {
    for (const line of statement.lines) {
      const isInflow = line.credit.greaterThan(0);
      const amount = isInflow ? line.credit : line.debit;

      const from = new Date(line.valueDate.getTime() - window);
      const to = new Date(line.valueDate.getTime() + window);

      let targetType: string | null = null;
      let targetId: string | null = null;

      if (isInflow) {
        const payments = await tx.customerPayment.findMany({
          where: {
            organizationId: input.organizationId,
            amount,
            paymentDate: { gte: from, lte: to },
            status: { notIn: [PaymentStatus.REVERSED, PaymentStatus.DRAFT] },
            postedJournalId: { not: null },
          },
          select: { id: true },
          take: 3,
        });
        if (payments.length === 1) {
          targetType = 'CUSTOMER_PAYMENT';
          targetId = payments[0].id;
        }
      } else {
        const payments = await tx.supplierPayment.findMany({
          where: {
            organizationId: input.organizationId,
            amount,
            paymentDate: { gte: from, lte: to },
            status: { notIn: [PaymentStatus.REVERSED, PaymentStatus.DRAFT] },
            postedJournalId: { not: null },
          },
          select: { id: true },
          take: 3,
        });
        if (payments.length === 1) {
          targetType = 'SUPPLIER_PAYMENT';
          targetId = payments[0].id;
        }
      }

      if (!targetType || !targetId) {
        unmatched += 1;
        continue;
      }

      const alreadyMatched = await tx.bankMatch.findFirst({
        where: { organizationId: input.organizationId, targetType, targetId },
        select: { id: true },
      });
      if (alreadyMatched) {
        unmatched += 1;
        continue;
      }

      await tx.bankMatch.create({
        data: {
          organizationId: input.organizationId,
          reconciliationId: reconciliation.id,
          statementLineId: line.id,
          targetType,
          targetId,
          amount,
          matchType: ReconciliationMatchType.AUTO_EXACT,
          matchedBy: input.userId ?? null,
        },
      });

      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: StatementLineStatus.MATCHED,
          matchedTargetType: targetType,
          matchedTargetId: targetId,
        },
      });

      matched += 1;
    }
  }

  return { matched, unmatched };
}

export async function finalizeReconciliation(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    reconciliationId: string;
    userId: string;
    allowSelfApproval?: boolean;
  }
) {
  const reconciliation = await tx.bankReconciliation.findFirst({
    where: { id: input.reconciliationId, organizationId: input.organizationId },
    include: { bankAccount: true },
  });

  if (!reconciliation) throw new AppError(404, 'NOT_FOUND', 'Reconciliation not found');
  if (reconciliation.status === ReconciliationStatus.FINALIZED) {
    throw new AppError(409, 'RECONCILIATION_CLOSED', 'This reconciliation is already finalized');
  }
  if (reconciliation.status === ReconciliationStatus.REVERSED) {
    throw new AppError(409, 'RECONCILIATION_REVERSED', 'A reversed reconciliation cannot be finalized');
  }

  if (reconciliation.preparedBy && reconciliation.preparedBy === input.userId && !input.allowSelfApproval) {
    throw new AppError(
      403,
      'SELF_APPROVAL_BLOCKED',
      'The user who prepared this reconciliation cannot finalize it'
    );
  }

  // Recompute both sides at finalization time: postings may have landed since
  // the draft was created, and a stale difference must not be signed off.
  const statementClosing = money(reconciliation.statementClosingBalance);
  const glClosing = await glBalanceUpTo(
    tx,
    input.organizationId,
    reconciliation.bankAccount.glAccountId,
    reconciliation.periodEnd
  );
  const difference = money(statementClosing.minus(glClosing));

  if (!difference.isZero()) {
    throw new AppError(
      409,
      'RECONCILIATION_OUT_OF_BALANCE',
      'Bank statement and ledger still disagree; resolve the outstanding items first',
      {
        statementClosing: statementClosing.toFixed(2),
        glClosing: glClosing.toFixed(2),
        difference: difference.toFixed(2),
      }
    );
  }

  const updated = await tx.bankReconciliation.update({
    where: { id: reconciliation.id },
    data: {
      glClosingBalance: glClosing,
      difference,
      status: ReconciliationStatus.FINALIZED,
      finalizedBy: input.userId,
      finalizedAt: new Date(),
    },
  });

  await emitDomainEvent(tx, {
    organizationId: input.organizationId,
    eventType: 'bank-reconciliation.finalized',
    aggregateType: 'BankReconciliation',
    aggregateId: reconciliation.id,
    payload: {
      bankAccount: reconciliation.bankAccount.name,
      periodEnd: reconciliation.periodEnd.toISOString(),
      closingBalance: glClosing.toFixed(2),
    },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// M-Pesa
// ---------------------------------------------------------------------------

export interface MpesaCallbackInput {
  organizationId: string;
  transactionType: MpesaTransactionType;
  amount: Prisma.Decimal | string | number;
  /** Stable key derived from the provider payload; makes the callback idempotent. */
  idempotencyKey: string;
  mpesaReceiptNumber?: string | null;
  merchantRequestId?: string | null;
  checkoutRequestId?: string | null;
  phoneNumber?: string | null;
  resultCode?: string | null;
  resultDesc?: string | null;
  accountReference?: string | null;
  bankAccountId?: string | null;
  rawPayload: unknown;
  currency?: CurrencyCode;
}

/**
 * Record an M-Pesa transaction from a provider callback.
 *
 * `CONFIRMED` means Safaricom confirmed the money moved. It is never inferred
 * from the fact that we sent a request. Duplicate callbacks update the same row
 * through `idempotencyKey`, so a provider retry cannot double-count revenue.
 */
export async function recordMpesaCallback(
  tx: Prisma.TransactionClient,
  input: MpesaCallbackInput
) {
  const amount = money(input.amount);
  if (!amount.greaterThan(0)) {
    throw new AppError(400, 'INVALID_AMOUNT', 'An M-Pesa transaction amount must be greater than zero');
  }

  const status =
    input.resultCode === '0'
      ? MpesaTransactionStatus.CONFIRMED
      : input.resultCode
        ? MpesaTransactionStatus.FAILED
        : MpesaTransactionStatus.ACKNOWLEDGED;

  const existing = await tx.mpesaTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    if (existing.organizationId !== input.organizationId) {
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This M-Pesa reference belongs to another organization');
    }
    return { created: false, transaction: existing };
  }

  if (input.bankAccountId) {
    const bank = await tx.bankAccount.findFirst({
      where: { id: input.bankAccountId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!bank) throw new AppError(404, 'NOT_FOUND', 'Bank account not found');
  }

  const transaction = await tx.mpesaTransaction.create({
    data: {
      organizationId: input.organizationId,
      bankAccountId: input.bankAccountId ?? null,
      transactionType: input.transactionType,
      merchantRequestId: input.merchantRequestId ?? null,
      checkoutRequestId: input.checkoutRequestId ?? null,
      mpesaReceiptNumber: input.mpesaReceiptNumber ?? null,
      phoneNumber: input.phoneNumber ?? null,
      amount,
      currency: input.currency ?? CurrencyCode.KES,
      status,
      resultCode: input.resultCode ?? null,
      resultDesc: input.resultDesc ?? null,
      accountReference: input.accountReference ?? null,
      rawPayloadJson: JSON.stringify(input.rawPayload),
      idempotencyKey: input.idempotencyKey,
    },
  });

  return { created: true, transaction };
}

/**
 * Link a confirmed M-Pesa transaction to the customer receipt it settled.
 * The amounts must agree exactly; a mismatch is a reconciliation problem, not
 * something the software may paper over.
 */
export async function linkMpesaToPayment(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; mpesaTransactionId: string; paymentId: string }
) {
  const mpesa = await tx.mpesaTransaction.findFirst({
    where: { id: input.mpesaTransactionId, organizationId: input.organizationId },
  });
  if (!mpesa) throw new AppError(404, 'NOT_FOUND', 'M-Pesa transaction not found');
  if (mpesa.status !== MpesaTransactionStatus.CONFIRMED) {
    throw new AppError(
      409,
      'MPESA_NOT_CONFIRMED',
      'Only a provider-confirmed M-Pesa transaction can settle a receipt'
    );
  }
  if (mpesa.customerPaymentId) {
    throw new AppError(409, 'ALREADY_LINKED', 'This M-Pesa transaction is already linked to a receipt');
  }

  const payment = await tx.customerPayment.findFirst({
    where: { id: input.paymentId, organizationId: input.organizationId },
  });
  if (!payment) throw new AppError(404, 'NOT_FOUND', 'Customer payment not found');

  if (!money(payment.amount).equals(money(mpesa.amount))) {
    throw new AppError(409, 'AMOUNT_MISMATCH', 'M-Pesa amount and receipt amount do not agree', {
      mpesaAmount: money(mpesa.amount).toFixed(2),
      paymentAmount: money(payment.amount).toFixed(2),
    });
  }

  const updated = await tx.mpesaTransaction.update({
    where: { id: mpesa.id },
    data: { customerPaymentId: payment.id },
  });

  return updated;
}

export function mpesaIdempotencyKey(payload: {
  TransID?: string;
  CheckoutRequestID?: string;
  MerchantRequestID?: string;
  BillRefNumber?: string;
  TransAmount?: string | number;
}): string {
  if (payload.TransID) return `mpesa:${payload.TransID}`;
  if (payload.CheckoutRequestID) return `mpesa-checkout:${payload.CheckoutRequestID}`;
  if (payload.MerchantRequestID) return `mpesa-merchant:${payload.MerchantRequestID}`;

  const amount = payload.TransAmount ? money(payload.TransAmount).toFixed(2) : '0.00';
  throw new AppError(
    400,
    'MPESA_REFERENCE_MISSING',
    'An M-Pesa payload without TransID, CheckoutRequestID or MerchantRequestID cannot be stored idempotently',
    { amount, billRef: payload.BillRefNumber ?? null }
  );
}

export const BANKING_ZERO = ZERO;
