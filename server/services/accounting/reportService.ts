import {
  AccountNormalBalance,
  AccountType,
  JournalStatus,
  Prisma,
} from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';
import { ZERO, dec, money, signedDelta } from './money';

/**
 * Financial reports, computed from posted journal lines only.
 *
 * `Account.currentBalance` is a cache and is deliberately not used here: it can
 * drift after a manual correction, whereas the posted lines are immutable and
 * auditable. Every report therefore derives from `JournalLine.baseDebit` /
 * `baseCredit`, which are functional-currency amounts, so multi-currency postings
 * roll up correctly.
 *
 * Reversed journals keep both their original lines and the reversal's lines.
 * Both statuses are included, which makes a reversal net to zero on every report
 * rather than removing history.
 */

const LEDGER_STATUSES = [JournalStatus.POSTED, JournalStatus.REVERSED];

type Movement = { debit: Prisma.Decimal; credit: Prisma.Decimal };

async function movements(
  tx: Prisma.TransactionClient,
  organizationId: string,
  range: { from?: Date; to?: Date }
): Promise<Map<string, Movement>> {
  const rows = await tx.journalLine.groupBy({
    by: ['accountId'],
    where: {
      journalEntry: {
        organizationId,
        status: { in: LEDGER_STATUSES },
        ...(range.from || range.to
          ? {
              postingDate: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lte: range.to } : {}),
              },
            }
          : {}),
      },
    },
    _sum: { baseDebit: true, baseCredit: true },
  });

  return new Map(
    rows.map((row) => [
      row.accountId,
      {
        debit: dec(row._sum.baseDebit ?? 0),
        credit: dec(row._sum.baseCredit ?? 0),
      },
    ])
  );
}

async function accountsWithMovements(
  tx: Prisma.TransactionClient,
  organizationId: string
) {
  return tx.account.findMany({
    where: { organizationId },
    select: {
      id: true,
      accountNumber: true,
      name: true,
      type: true,
      normalBalance: true,
      isActive: true,
    },
    orderBy: { accountNumber: 'asc' },
  });
}

export interface TrialBalanceRow {
  accountId: string;
  accountNumber: string;
  name: string;
  type: AccountType;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
}

export async function trialBalance(
  tx: Prisma.TransactionClient,
  organizationId: string,
  from: Date,
  to: Date,
  options: { includeZero?: boolean } = {}
) {
  const [accounts, before, period] = await Promise.all([
    accountsWithMovements(tx, organizationId),
    movements(tx, organizationId, { to: new Date(from.getTime() - 1) }),
    movements(tx, organizationId, { from, to }),
  ]);

  const rows: TrialBalanceRow[] = [];
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  let totalOpening = ZERO;
  let totalClosing = ZERO;

  for (const account of accounts) {
    const openingMove = before.get(account.id);
    const periodMove = period.get(account.id);

    const opening = openingMove
      ? signedDelta(account.normalBalance, openingMove.debit, openingMove.credit)
      : ZERO;
    const debit = periodMove?.debit ?? ZERO;
    const credit = periodMove?.credit ?? ZERO;

    if (!options.includeZero && opening.isZero() && debit.isZero() && credit.isZero()) {
      continue;
    }

    const closing = opening.plus(signedDelta(account.normalBalance, debit, credit));

    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    totalOpening = totalOpening.plus(opening);
    totalClosing = totalClosing.plus(closing);

    rows.push({
      accountId: account.id,
      accountNumber: account.accountNumber,
      name: account.name,
      type: account.type,
      opening: opening.toFixed(2),
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      closing: closing.toFixed(2),
    });
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    totals: {
      opening: totalOpening.toFixed(2),
      debit: totalDebit.toFixed(2),
      credit: totalCredit.toFixed(2),
      closing: totalClosing.toFixed(2),
    },
    balanced: totalDebit.equals(totalCredit),
  };
}

export interface ProfitAndLossSection {
  title: string;
  rows: Array<{ accountId: string; accountNumber: string; name: string; amount: string }>;
  total: string;
}

export async function profitAndLoss(
  tx: Prisma.TransactionClient,
  organizationId: string,
  from: Date,
  to: Date
) {
  const [accounts, period] = await Promise.all([
    accountsWithMovements(tx, organizationId),
    movements(tx, organizationId, { from, to }),
  ]);

  const revenue: ProfitAndLossSection['rows'] = [];
  const expenses: ProfitAndLossSection['rows'] = [];
  let revenueTotal = ZERO;
  let expenseTotal = ZERO;

  for (const account of accounts) {
    const move = period.get(account.id);
    if (!move) continue;

    if (account.type === AccountType.REVENUE) {
      const amount = money(move.credit.minus(move.debit));
      if (amount.isZero()) continue;
      revenueTotal = revenueTotal.plus(amount);
      revenue.push({
        accountId: account.id,
        accountNumber: account.accountNumber,
        name: account.name,
        amount: amount.toFixed(2),
      });
    } else if (account.type === AccountType.EXPENSE) {
      const amount = money(move.debit.minus(move.credit));
      if (amount.isZero()) continue;
      expenseTotal = expenseTotal.plus(amount);
      expenses.push({
        accountId: account.id,
        accountNumber: account.accountNumber,
        name: account.name,
        amount: amount.toFixed(2),
      });
    }
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    revenue: { title: 'Revenue', rows: revenue, total: revenueTotal.toFixed(2) },
    expenses: { title: 'Operating expenses', rows: expenses, total: expenseTotal.toFixed(2) },
    grossProfit: revenueTotal.toFixed(2),
    netProfit: revenueTotal.minus(expenseTotal).toFixed(2),
  };
}

export async function balanceSheet(
  tx: Prisma.TransactionClient,
  organizationId: string,
  asOf: Date
) {
  const [accounts, cumulative] = await Promise.all([
    accountsWithMovements(tx, organizationId),
    movements(tx, organizationId, { to: asOf }),
  ]);

  const groups: Record<'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE', TrialBalanceRow[]> = {
    ASSET: [],
    LIABILITY: [],
    EQUITY: [],
    REVENUE: [],
    EXPENSE: [],
  };

  let revenueTotal = ZERO;
  let expenseTotal = ZERO;

  for (const account of accounts) {
    const move = cumulative.get(account.id);
    if (!move) continue;

    const balance = signedDelta(account.normalBalance, move.debit, move.credit);
    if (balance.isZero()) continue;

    if (account.type === AccountType.REVENUE) revenueTotal = revenueTotal.plus(balance);
    if (account.type === AccountType.EXPENSE) expenseTotal = expenseTotal.plus(balance);

    groups[account.type].push({
      accountId: account.id,
      accountNumber: account.accountNumber,
      name: account.name,
      type: account.type,
      opening: '0.00',
      debit: move.debit.toFixed(2),
      credit: move.credit.toFixed(2),
      closing: balance.toFixed(2),
    });
  }

  const totalBy = (type: keyof typeof groups) =>
    groups[type].reduce((acc, row) => acc.plus(dec(row.closing)), ZERO);

  const assets = totalBy('ASSET');
  const liabilities = totalBy('LIABILITY');
  const equity = totalBy('EQUITY');
  const retained = revenueTotal.minus(expenseTotal);

  const liabilitiesAndEquity = liabilities.plus(equity).plus(retained);
  const difference = assets.minus(liabilitiesAndEquity);

  return {
    asOf: asOf.toISOString(),
    assets: { rows: groups.ASSET, total: assets.toFixed(2) },
    liabilities: { rows: groups.LIABILITY, total: liabilities.toFixed(2) },
    equity: {
      rows: groups.EQUITY,
      total: equity.toFixed(2),
      currentEarnings: retained.toFixed(2),
    },
    totalLiabilitiesAndEquity: liabilitiesAndEquity.toFixed(2),
    difference: difference.toFixed(2),
    balanced: difference.isZero(),
  };
}

export async function arAgeing(
  tx: Prisma.TransactionClient,
  organizationId: string,
  asOf: Date = new Date()
) {
  const invoices = await tx.salesInvoice.findMany({
    where: { organizationId, postedJournalId: { not: null } },
    include: { customer: { select: { id: true, name: true } } },
    orderBy: { dueDate: 'asc' },
  });

  const buckets = { current: ZERO, days30: ZERO, days60: ZERO, days90: ZERO, over90: ZERO };
  const rows: Array<{
    invoiceId: string;
    invoiceNumber: string;
    customer: string;
    dueDate: string;
    outstanding: string;
    daysOverdue: number;
    bucket: string;
  }> = [];

  for (const invoice of invoices) {
    const outstanding = money(invoice.totalAmount).minus(invoice.paidAmount);
    if (!outstanding.greaterThan(0)) continue;

    const daysOverdue = Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86_400_000);
    let bucket: keyof typeof buckets = 'current';
    if (daysOverdue > 90) bucket = 'over90';
    else if (daysOverdue > 60) bucket = 'days90';
    else if (daysOverdue > 30) bucket = 'days60';
    else if (daysOverdue > 0) bucket = 'days30';

    buckets[bucket] = buckets[bucket].plus(outstanding);

    rows.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customer: invoice.customer.name,
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      outstanding: outstanding.toFixed(2),
      daysOverdue,
      bucket,
    });
  }

  return {
    asOf: asOf.toISOString(),
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.toFixed(2)])),
    total: Object.values(buckets).reduce((a, b) => a.plus(b), ZERO).toFixed(2),
    rows,
  };
}

/** Cash movement through bank and cash GL accounts for a period. */
export async function cashFlow(
  tx: Prisma.TransactionClient,
  organizationId: string,
  from: Date,
  to: Date
) {
  const bankAccounts = await tx.bankAccount.findMany({
    where: { organizationId },
    include: { glAccount: { select: { id: true, accountNumber: true, name: true } } },
  });

  const glIds = Array.from(new Set(bankAccounts.map((b) => b.glAccountId)));

  const beforeRows = await tx.journalLine.groupBy({
    by: ['accountId'],
    where: {
      accountId: { in: glIds },
      journalEntry: {
        organizationId,
        status: { in: LEDGER_STATUSES },
        postingDate: { lt: from },
      },
    },
    _sum: { baseDebit: true, baseCredit: true },
  });

  const periodRows = await tx.journalLine.groupBy({
    by: ['accountId'],
    where: {
      accountId: { in: glIds },
      journalEntry: {
        organizationId,
        status: { in: LEDGER_STATUSES },
        postingDate: { gte: from, lte: to },
      },
    },
    _sum: { baseDebit: true, baseCredit: true },
  });

  const toMap = (rows: typeof beforeRows) =>
    new Map(
      rows.map((r) => [r.accountId, { debit: dec(r._sum.baseDebit ?? 0), credit: dec(r._sum.baseCredit ?? 0) }])
    );

  const before = toMap(beforeRows);
  const period = toMap(periodRows);
  const glNames = new Map(bankAccounts.map((b) => [b.glAccountId, b.glAccount]));

  const accounts = glIds.map((id) => {
    const opening = before.get(id);
    const move = period.get(id);
    const openingBalance = opening ? opening.debit.minus(opening.credit) : ZERO;
    const inflow = move?.debit ?? ZERO;
    const outflow = move?.credit ?? ZERO;

    return {
      glAccountId: id,
      accountNumber: glNames.get(id)?.accountNumber ?? '',
      name: glNames.get(id)?.name ?? '',
      opening: openingBalance.toFixed(2),
      inflow: inflow.toFixed(2),
      outflow: outflow.toFixed(2),
      closing: openingBalance.plus(inflow).minus(outflow).toFixed(2),
    };
  });

  const sum = (key: 'opening' | 'inflow' | 'outflow' | 'closing') =>
    accounts.reduce((acc, a) => acc.plus(dec(a[key])), ZERO);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    accounts,
    totals: {
      opening: sum('opening').toFixed(2),
      inflow: sum('inflow').toFixed(2),
      outflow: sum('outflow').toFixed(2),
      closing: sum('closing').toFixed(2),
      netMovement: sum('inflow').minus(sum('outflow')).toFixed(2),
    },
  };
}

/** Budget vs actual for a fiscal year, by account and period. */
export async function budgetVariance(
  tx: Prisma.TransactionClient,
  organizationId: string,
  budgetId: string
) {
  const budget = await tx.budget.findFirst({
    where: { id: budgetId, organizationId },
    include: {
      lines: { include: { account: { select: { accountNumber: true, name: true, type: true } } } },
      fiscalYear: { select: { startDate: true, endDate: true, name: true } },
    },
  });

  if (!budget) throw new AppError(404, 'NOT_FOUND', 'Budget not found');

  const actual = await movements(tx, organizationId, {
    from: budget.fiscalYear.startDate,
    to: budget.fiscalYear.endDate,
  });

  const byAccount = new Map<
    string,
    { accountNumber: string; name: string; type: AccountType; budget: Prisma.Decimal; actual: Prisma.Decimal }
  >();

  for (const line of budget.lines) {
    const entry = byAccount.get(line.accountId) ?? {
      accountNumber: line.account.accountNumber,
      name: line.account.accountNumber,
      type: line.account.type,
      budget: ZERO,
      actual: ZERO,
    };
    entry.name = line.account.name;
    entry.budget = entry.budget.plus(line.amount);
    byAccount.set(line.accountId, entry);
  }

  for (const [accountId, entry] of byAccount) {
    const move = actual.get(accountId);
    if (!move) continue;
    entry.actual =
      entry.type === AccountType.REVENUE
        ? money(move.credit.minus(move.debit))
        : money(move.debit.minus(move.credit));
  }

  const rows = Array.from(byAccount.entries()).map(([accountId, entry]) => {
    const variance = entry.actual.minus(entry.budget);
    return {
      accountId,
      accountNumber: entry.accountNumber,
      name: entry.name,
      type: entry.type,
      budget: entry.budget.toFixed(2),
      actual: entry.actual.toFixed(2),
      variance: variance.toFixed(2),
      utilisationPercent: entry.budget.isZero()
        ? null
        : entry.actual.div(entry.budget).times(100).toDecimalPlaces(1).toFixed(1),
    };
  });

  return {
    budget: {
      id: budget.id,
      name: budget.name,
      version: budget.version,
      status: budget.status,
      fiscalYear: budget.fiscalYear.name,
    },
    rows,
  };
}

export { AccountNormalBalance };
