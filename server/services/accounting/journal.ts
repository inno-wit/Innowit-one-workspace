import {
  Prisma,
  JournalStatus,
  CurrencyCode,
  AccountNormalBalance,
} from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../middleware/errorHandler';
import {
  MoneyInput,
  dec,
  money,
  rate,
  ZERO,
  signedDelta,
  toBase,
  hasSubCentPrecision,
} from './money';
import { allocateDocumentNumber } from './sequences';
import { resolvePostingPeriod } from './periods';
import { recordAudit, emitDomainEvent } from './audit';

/**
 * CANONICAL GENERAL LEDGER POSTING ENGINE
 * ======================================
 *
 * Every journal in the system — manual, invoice, receipt, bill, payment,
 * reversal, revaluation — is written by this module. Nothing else may create a
 * `JournalEntry` or mutate `Account.currentBalance`.
 *
 * Invariants enforced here (Gate 4.2):
 *  1. At least two lines.
 *  2. Every line has exactly one of debit/credit, and it is strictly positive.
 *  3. Sum(debit) === Sum(credit) exactly, at 2dp, with no tolerance.
 *  4. Every account belongs to the posting organization, is active, is
 *     postable and is not a control account unless the caller is a recognised
 *     source module.
 *  5. Posting date resolves to an open accounting period.
 *  6. `sourceKey` is a real idempotency key: same key => one journal.
 *  7. The header, lines, balance cache, audit row and domain event are written
 *     in one transaction. Any failure rolls back all of them.
 *  8. A POSTED journal is immutable. Corrections happen by reversal only.
 */

export interface PostingLineInput {
  accountId: string;
  description?: string | null;
  debit?: MoneyInput;
  credit?: MoneyInput;
  costCentreId?: string | null;
  dimensionTag?: string | null;
}

export type PostableStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED';

export interface PostJournalInput {
  organizationId: string;
  branchId?: string | null;
  postingDate: Date | string;
  description: string;
  sourceModule: string;
  sourceId?: string | null;
  /** Idempotency key, unique per organization. Strongly recommended. */
  sourceKey?: string | null;
  transactionRef?: string | null;
  currency?: CurrencyCode;
  exchangeRate?: MoneyInput;
  lines: PostingLineInput[];
  createdBy?: string | null;
  postedBy?: string | null;
  status?: PostableStatus;
  entryNumber?: string;
  /** Only recognised source modules may post directly to control accounts. */
  allowControlAccounts?: boolean;
  allowSoftClosedPeriod?: boolean;
  /** Reject >2dp input instead of rounding it. Manual entry should use this. */
  strictPrecision?: boolean;
  ipAddress?: string | null;
  correlationId?: string | null;
}

export interface NormalisedLine {
  accountId: string;
  description: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  baseDebit: Prisma.Decimal;
  baseCredit: Prisma.Decimal;
  costCentreId: string | null;
  dimensionTag: string | null;
  normalBalance: AccountNormalBalance;
}

export interface PostJournalResult {
  journal: {
    id: string;
    entryNumber: string;
    organizationId: string;
    status: JournalStatus;
    postingDate: Date;
    description: string;
    sourceModule: string;
    sourceId: string | null;
    sourceKey: string | null;
    currency: CurrencyCode;
    exchangeRate: Prisma.Decimal;
    totalDebit: Prisma.Decimal;
    totalCredit: Prisma.Decimal;
    periodId: string | null;
    branchId: string | null;
    lines: Array<{
      id: string;
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
    }>;
  };
  /** False when an existing journal was returned for a repeated sourceKey. */
  created: boolean;
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, 'INVALID_POSTING_DATE', 'Posting date is not a valid date');
  }
  return parsed;
}

/**
 * Validate lines and resolve their accounts. Pure validation: no writes.
 */
export async function normaliseJournalLines(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lines: PostingLineInput[],
  options: {
    strictPrecision?: boolean;
    allowControlAccounts?: boolean;
    exchangeRate?: MoneyInput;
  } = {}
): Promise<{ lines: NormalisedLine[]; totalDebit: Prisma.Decimal; totalCredit: Prisma.Decimal }> {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new AppError(
      400,
      'JOURNAL_TOO_SHORT',
      'A journal entry requires at least two lines'
    );
  }

  const fxRate = options.exchangeRate === undefined ? new Prisma.Decimal(1) : rate(options.exchangeRate);

  const prepared = lines.map((line, index) => {
    if (!line.accountId) {
      throw new AppError(400, 'ACCOUNT_REQUIRED', `Line ${index + 1} is missing an account`);
    }

    if (options.strictPrecision) {
      if (line.debit !== undefined && hasSubCentPrecision(dec(line.debit))) {
        throw new AppError(400, 'AMOUNT_PRECISION', `Line ${index + 1} debit has more than 2 decimal places`);
      }
      if (line.credit !== undefined && hasSubCentPrecision(dec(line.credit))) {
        throw new AppError(400, 'AMOUNT_PRECISION', `Line ${index + 1} credit has more than 2 decimal places`);
      }
    }

    const debit = money(line.debit ?? ZERO);
    const credit = money(line.credit ?? ZERO);

    if (debit.isNegative() || credit.isNegative()) {
      throw new AppError(
        400,
        'NEGATIVE_AMOUNT',
        `Line ${index + 1} has a negative amount. Debits and credits must be positive.`
      );
    }
    if (debit.isZero() && credit.isZero()) {
      throw new AppError(400, 'EMPTY_LINE', `Line ${index + 1} has neither a debit nor a credit`);
    }
    if (!debit.isZero() && !credit.isZero()) {
      throw new AppError(
        400,
        'DEBIT_AND_CREDIT_ON_SAME_LINE',
        `Line ${index + 1} has both a debit and a credit`
      );
    }

    return { line, debit, credit };
  });

  const accountIds = Array.from(new Set(prepared.map((p) => p.line.accountId)));

  const accounts = await tx.account.findMany({
    where: { id: { in: accountIds }, organizationId },
    select: {
      id: true,
      accountNumber: true,
      name: true,
      isActive: true,
      isPostable: true,
      isControl: true,
      controlType: true,
      normalBalance: true,
      type: true,
    },
  });

  const byId = new Map(accounts.map((a) => [a.id, a]));

  if (byId.size !== accountIds.length) {
    const missing = accountIds.filter((id) => !byId.has(id));
    throw new AppError(
      403,
      'ACCOUNT_NOT_ACCESSIBLE',
      'One or more accounts do not exist in this organization',
      { accountIds: missing }
    );
  }

  const normalised: NormalisedLine[] = prepared.map(({ line, debit, credit }, index) => {
    const account = byId.get(line.accountId)!;

    if (!account.isActive) {
      throw new AppError(
        400,
        'ACCOUNT_INACTIVE',
        `Line ${index + 1}: account ${account.accountNumber} (${account.name}) is inactive`
      );
    }
    if (!account.isPostable) {
      throw new AppError(
        400,
        'ACCOUNT_NOT_POSTABLE',
        `Line ${index + 1}: account ${account.accountNumber} (${account.name}) is a summary account and cannot be posted to`
      );
    }
    if (account.isControl && !options.allowControlAccounts) {
      throw new AppError(
        400,
        'CONTROL_ACCOUNT_NOT_POSTABLE',
        `Line ${index + 1}: account ${account.accountNumber} (${account.name}) is a control account. Post through the subledger.`
      );
    }

    return {
      accountId: line.accountId,
      description: line.description ?? null,
      debit,
      credit,
      baseDebit: toBase(debit, fxRate),
      baseCredit: toBase(credit, fxRate),
      costCentreId: line.costCentreId ?? null,
      dimensionTag: line.dimensionTag ?? null,
      normalBalance: account.normalBalance,
    };
  });

  const totalDebit = normalised.reduce((acc, l) => acc.plus(l.debit), ZERO);
  const totalCredit = normalised.reduce((acc, l) => acc.plus(l.credit), ZERO);

  if (!totalDebit.equals(totalCredit)) {
    throw new AppError(
      400,
      'UNBALANCED_JOURNAL',
      'Journal is not balanced: total debits must equal total credits exactly',
      {
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        difference: totalDebit.minus(totalCredit).toFixed(2),
      }
    );
  }

  return { lines: normalised, totalDebit, totalCredit };
}

/**
 * Apply balance-cache deltas. The cache is derived data; the ledger lines are
 * the source of truth and `reconcileAccountBalances` can rebuild the cache.
 */
async function applyBalanceDeltas(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lines: NormalisedLine[],
  direction: 1 | -1 = 1
): Promise<void> {
  const deltas = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const delta = signedDelta(line.normalBalance, line.debit, line.credit).times(direction);
    const current = deltas.get(line.accountId) ?? ZERO;
    deltas.set(line.accountId, current.plus(delta));
  }

  for (const [accountId, delta] of deltas) {
    if (delta.isZero()) continue;
    const updated = await tx.account.updateMany({
      where: { id: accountId, organizationId },
      data: { currentBalance: { increment: delta } },
    });
    if (updated.count !== 1) {
      throw new AppError(409, 'BALANCE_UPDATE_FAILED', 'Account balance update failed');
    }
  }
}

async function acquireSourceLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sourceModule: string,
  sourceKey: string
): Promise<void> {
  const lockKey = `${organizationId}:${sourceModule}:${sourceKey}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
}

/**
 * Post (or draft) a journal inside an existing transaction.
 *
 * Use this when the journal is part of a larger unit of work, e.g. an invoice
 * posting that must also create an eTIMS outbox row atomically.
 */
export async function postJournalInTransaction(
  tx: Prisma.TransactionClient,
  input: PostJournalInput
): Promise<PostJournalResult> {
  const postingDate = toDate(input.postingDate);
  const status: PostableStatus = input.status ?? 'POSTED';
  const currency = input.currency ?? CurrencyCode.KES;
  const exchangeRate = rate(input.exchangeRate ?? 1);

  if (input.sourceKey) {
    await acquireSourceLock(tx, input.organizationId, input.sourceModule, input.sourceKey);

    const existing = await tx.journalEntry.findFirst({
      where: { organizationId: input.organizationId, sourceKey: input.sourceKey },
      include: { lines: true },
    });
    if (existing) {
      return {
        journal: {
          ...existing,
          totalDebit: existing.lines.reduce((acc, l) => acc.plus(l.debit), ZERO),
          totalCredit: existing.lines.reduce((acc, l) => acc.plus(l.credit), ZERO),
        } as PostJournalResult['journal'],
        created: false,
      };
    }
  }

  // A draft does not need an open period, but it must not be able to claim a
  // date outside the calendar when it is eventually posted.
  let periodId: string | null = null;
  if (status === 'POSTED') {
    const period = await resolvePostingPeriod(tx, input.organizationId, postingDate, {
      allowSoftClosed: input.allowSoftClosedPeriod,
    });
    periodId = period?.id ?? null;
  } else {
    const period = await resolvePostingPeriod(tx, input.organizationId, postingDate, {
      optional: true,
      allowSoftClosed: true,
    });
    periodId = period?.id ?? null;
  }

  const { lines, totalDebit, totalCredit } = await normaliseJournalLines(
    tx,
    input.organizationId,
    input.lines,
    {
      strictPrecision: input.strictPrecision,
      allowControlAccounts: input.allowControlAccounts,
      exchangeRate,
    }
  );

  const entryNumber =
    input.entryNumber ??
    (await allocateDocumentNumber(tx, {
      organizationId: input.organizationId,
      prefix: 'JE',
      scope: input.branchId ?? 'GLOBAL',
      year: postingDate.getUTCFullYear(),
    }));

  const journalStatus =
    status === 'POSTED'
      ? JournalStatus.POSTED
      : status === 'PENDING_APPROVAL'
        ? JournalStatus.PENDING_APPROVAL
        : JournalStatus.DRAFT;

  const journal = await tx.journalEntry.create({
    data: {
      organizationId: input.organizationId,
      entryNumber,
      postingDate,
      sourceModule: input.sourceModule,
      sourceId: input.sourceId ?? null,
      description: input.description,
      status: journalStatus,
      branchId: input.branchId ?? null,
      periodId,
      currency,
      exchangeRate,
      sourceKey: input.sourceKey ?? null,
      transactionRef: input.transactionRef ?? null,
      createdBy: input.createdBy ?? null,
      postedAt: status === 'POSTED' ? new Date() : null,
      postedBy: status === 'POSTED' ? input.postedBy ?? input.createdBy ?? null : null,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          currency,
          fxRate: exchangeRate,
          baseDebit: line.baseDebit,
          baseCredit: line.baseCredit,
          costCentreId: line.costCentreId,
          dimensionTag: line.dimensionTag,
        })),
      },
    },
    include: { lines: true },
  });

  if (status === 'POSTED') {
    await applyBalanceDeltas(tx, input.organizationId, lines, 1);
  }

  await recordAudit(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId ?? null,
    userId: input.postedBy ?? input.createdBy ?? null,
    action: status === 'POSTED' ? 'POST' : 'CREATE',
    entityType: 'JournalEntry',
    entityId: journal.id,
    changes: {
      entryNumber,
      sourceModule: input.sourceModule,
      sourceId: input.sourceId ?? null,
      sourceKey: input.sourceKey ?? null,
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      status: journalStatus,
    },
    ipAddress: input.ipAddress ?? null,
    correlationId: input.correlationId ?? null,
  });

  if (status === 'POSTED') {
    await emitDomainEvent(tx, {
      organizationId: input.organizationId,
      eventType: 'journal.posted',
      aggregateType: 'JournalEntry',
      aggregateId: journal.id,
      payload: {
        entryNumber,
        sourceModule: input.sourceModule,
        sourceId: input.sourceId ?? null,
        totalDebit: totalDebit.toFixed(2),
      },
    });
  }

  return {
    journal: journal as PostJournalResult['journal'],
    created: true,
  };
}

/**
 * Post a journal in its own transaction.
 */
export async function postJournal(input: PostJournalInput): Promise<PostJournalResult> {
  return prisma.$transaction((tx) => postJournalInTransaction(tx, input));
}

/**
 * Move a draft or pending journal into the ledger.
 *
 * Re-validates everything at post time: a draft created before a period was
 * closed must not slip through afterwards.
 */
export async function postDraftJournal(
  organizationId: string,
  journalId: string,
  postedBy: string | null,
  options: { allowSoftClosedPeriod?: boolean; ipAddress?: string | null; correlationId?: string | null } = {}
): Promise<PostJournalResult> {
  return prisma.$transaction(async (tx) => {
    const journal = await tx.journalEntry.findFirst({
      where: { id: journalId, organizationId },
      include: { lines: true },
    });

    if (!journal) {
      throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');
    }
    if (journal.status === JournalStatus.POSTED) {
      return {
        journal: {
          ...journal,
          totalDebit: journal.lines.reduce((acc, l) => acc.plus(l.debit), ZERO),
          totalCredit: journal.lines.reduce((acc, l) => acc.plus(l.credit), ZERO),
        } as PostJournalResult['journal'],
        created: false,
      };
    }
    if (journal.status === JournalStatus.REVERSED || journal.status === JournalStatus.VOID) {
      throw new AppError(409, 'JOURNAL_NOT_POSTABLE', `A ${journal.status} journal cannot be posted`);
    }

    const period = await resolvePostingPeriod(tx, organizationId, journal.postingDate, {
      allowSoftClosed: options.allowSoftClosedPeriod,
    });

    const { lines } = await normaliseJournalLines(
      tx,
      organizationId,
      journal.lines.map((line) => ({
        accountId: line.accountId,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        costCentreId: line.costCentreId,
        dimensionTag: line.dimensionTag,
      })),
      { allowControlAccounts: true, exchangeRate: journal.exchangeRate }
    );

    const updated = await tx.journalEntry.update({
      where: { id: journal.id },
      data: {
        status: JournalStatus.POSTED,
        periodId: period?.id ?? journal.periodId,
        postedAt: new Date(),
        postedBy,
      },
      include: { lines: true },
    });

    await applyBalanceDeltas(tx, organizationId, lines, 1);

    await recordAudit(tx, {
      organizationId,
      branchId: journal.branchId,
      userId: postedBy,
      action: 'POST',
      entityType: 'JournalEntry',
      entityId: journal.id,
      changes: { entryNumber: journal.entryNumber, previousStatus: journal.status },
      ipAddress: options.ipAddress ?? null,
      correlationId: options.correlationId ?? null,
    });

    await emitDomainEvent(tx, {
      organizationId,
      eventType: 'journal.posted',
      aggregateType: 'JournalEntry',
      aggregateId: journal.id,
      payload: { entryNumber: journal.entryNumber, sourceModule: journal.sourceModule },
    });

    return {
      journal: {
        ...updated,
        totalDebit: updated.lines.reduce((acc, l) => acc.plus(l.debit), ZERO),
        totalCredit: updated.lines.reduce((acc, l) => acc.plus(l.credit), ZERO),
      } as PostJournalResult['journal'],
      created: true,
    };
  });
}

/**
 * Reverse a posted journal exactly.
 *
 * The reversal is a new POSTED journal with debits and credits swapped, linked
 * back to the original. The original is flagged and can never be reversed
 * twice: the reversal's `sourceKey` is derived from the original id and carries
 * a unique constraint, so a concurrent double reversal fails cleanly.
 */
export async function reverseJournal(input: {
  organizationId: string;
  journalId: string;
  reason: string;
  reversedBy: string | null;
  reversalDate?: Date | string;
  allowSoftClosedPeriod?: boolean;
}): Promise<{ reversal: PostJournalResult['journal']; originalId: string }> {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new AppError(400, 'REVERSAL_REASON_REQUIRED', 'A reversal reason is required');
  }

  return prisma.$transaction(async (tx) => {
    const original = await tx.journalEntry.findFirst({
      where: { id: input.journalId, organizationId: input.organizationId },
      include: { lines: true },
    });

    if (!original) {
      throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');
    }
    if (original.status !== JournalStatus.POSTED) {
      throw new AppError(
        409,
        'JOURNAL_NOT_POSTED',
        `Only a POSTED journal can be reversed (current status: ${original.status})`
      );
    }
    if (original.isReversed || original.reversalEntryId) {
      throw new AppError(409, 'ALREADY_REVERSED', 'This journal has already been reversed');
    }
    if (original.sourceModule.endsWith('_REVERSAL')) {
      throw new AppError(409, 'CANNOT_REVERSE_REVERSAL', 'A reversal journal cannot itself be reversed');
    }

    const sourceKey = `reversal:${original.id}`;
    await acquireSourceLock(tx, input.organizationId, 'REVERSAL', original.id);

    const existingReversal = await tx.journalEntry.findFirst({
      where: { organizationId: input.organizationId, sourceKey },
      include: { lines: true },
    });
    if (existingReversal) {
      throw new AppError(409, 'ALREADY_REVERSED', 'This journal has already been reversed');
    }

    const reversalDate = input.reversalDate ? toDate(input.reversalDate) : new Date();

    const result = await postJournalInTransaction(tx, {
      organizationId: input.organizationId,
      branchId: original.branchId,
      postingDate: reversalDate,
      description: `Reversal of ${original.entryNumber}: ${input.reason}`,
      sourceModule: `${original.sourceModule}_REVERSAL`,
      sourceId: original.id,
      sourceKey,
      transactionRef: original.entryNumber,
      currency: original.currency,
      exchangeRate: original.exchangeRate,
      allowControlAccounts: true,
      allowSoftClosedPeriod: input.allowSoftClosedPeriod,
      postedBy: input.reversedBy,
      createdBy: input.reversedBy,
      status: 'POSTED',
      lines: original.lines.map((line) => ({
        accountId: line.accountId,
        description: `Reversal: ${line.description ?? original.description}`,
        debit: line.credit,
        credit: line.debit,
        costCentreId: line.costCentreId,
        dimensionTag: line.dimensionTag,
      })),
    });

    await tx.journalEntry.update({
      where: { id: original.id },
      data: {
        isReversed: true,
        reversalEntryId: result.journal.id,
        reversalReason: input.reason,
        status: JournalStatus.REVERSED,
      },
    });

    await recordAudit(tx, {
      organizationId: input.organizationId,
      branchId: original.branchId,
      userId: input.reversedBy,
      action: 'REVERSE',
      entityType: 'JournalEntry',
      entityId: original.id,
      changes: {
        originalEntryNumber: original.entryNumber,
        reversalEntryNumber: result.journal.entryNumber,
        reason: input.reason,
      },
    });

    await emitDomainEvent(tx, {
      organizationId: input.organizationId,
      eventType: 'journal.reversed',
      aggregateType: 'JournalEntry',
      aggregateId: original.id,
      payload: {
        originalEntryNumber: original.entryNumber,
        reversalEntryNumber: result.journal.entryNumber,
        reason: input.reason,
      },
    });

    return { reversal: result.journal, originalId: original.id };
  });
}

/**
 * Rebuild `Account.currentBalance` from posted journal lines and report drift.
 *
 * Posted lines are the source of truth. The cache must be provably derivable
 * from them; otherwise it must never be trusted by a report.
 */
export async function reconcileAccountBalances(
  organizationId: string,
  options: { apply?: boolean } = {}
): Promise<{
  accounts: Array<{
    accountId: string;
    accountNumber: string;
    name: string;
    cached: string;
    derived: string;
    difference: string;
  }>;
  drifted: number;
  applied: boolean;
}> {
  return prisma.$transaction(async (tx) => {
    const accounts = await tx.account.findMany({
      where: { organizationId },
      select: {
        id: true,
        accountNumber: true,
        name: true,
        currentBalance: true,
        normalBalance: true,
      },
      orderBy: { accountNumber: 'asc' },
    });

    const rows = await tx.$queryRaw<
      Array<{ accountId: string; debit: string; credit: string }>
    >`
      SELECT l."accountId" AS "accountId",
             COALESCE(SUM(l."baseDebit"), 0)::text AS "debit",
             COALESCE(SUM(l."baseCredit"), 0)::text AS "credit"
      FROM "JournalLine" l
      JOIN "JournalEntry" j ON j."id" = l."journalEntryId"
      WHERE j."organizationId" = ${organizationId}
        AND j."status" IN ('POSTED', 'REVERSED')
      GROUP BY l."accountId"
    `;

    const derived = new Map(rows.map((r) => [r.accountId, r]));

    const result: Array<{
      accountId: string;
      accountNumber: string;
      name: string;
      cached: string;
      derived: string;
      difference: string;
    }> = [];

    for (const account of accounts) {
      const row = derived.get(account.id);
      const totalDebit = dec(row?.debit ?? '0');
      const totalCredit = dec(row?.credit ?? '0');
      const derivedBalance = signedDelta(account.normalBalance, totalDebit, totalCredit);
      const cached = money(account.currentBalance);
      const difference = derivedBalance.minus(cached);

      if (!difference.isZero()) {
        result.push({
          accountId: account.id,
          accountNumber: account.accountNumber,
          name: account.name,
          cached: cached.toFixed(2),
          derived: derivedBalance.toFixed(2),
          difference: difference.toFixed(2),
        });

        if (options.apply) {
          await tx.account.update({
            where: { id: account.id },
            data: { currentBalance: derivedBalance },
          });
        }
      }
    }

    if (options.apply && result.length > 0) {
      await recordAudit(tx, {
        organizationId,
        action: 'RECONCILE',
        entityType: 'Account',
        entityId: 'BALANCE_CACHE',
        changes: { corrected: result.length, accounts: result },
      });
    }

    return { accounts: result, drifted: result.length, applied: Boolean(options.apply) };
  });
}
