import { Prisma, PeriodStatus, FiscalYearStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../middleware/errorHandler';

/**
 * Fiscal calendar and period locking.
 *
 * Before Phase 4 a journal could be posted to any date with no concept of a
 * closed month. This module owns the calendar:
 *
 *  - every organization gets a rolling fiscal calendar, created on first use
 *  - every posting resolves to exactly one `AccountingPeriod`
 *  - CLOSED periods reject all posting, SOFT_CLOSED rejects everything except
 *    explicitly privileged adjustments
 *
 * The calendar is created lazily rather than requiring an admin step, so an
 * existing organization keeps working after the Phase 4 migration without a
 * data migration for historical years.
 */

export interface ResolvePeriodOptions {
  /** Allow posting into a SOFT_CLOSED period (privileged adjustments only). */
  allowSoftClosed?: boolean;
  /** Do not throw when no period exists; return null instead. */
  optional?: boolean;
}

/** Start of the fiscal year containing `date`, given a 1-based start month. */
export function fiscalYearStart(date: Date, startMonth: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const startYear = month >= startMonth ? year : year - 1;
  return new Date(Date.UTC(startYear, startMonth - 1, 1, 0, 0, 0, 0));
}

export function fiscalYearEnd(start: Date): Date {
  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 1, 0, 0, 0, 0));
  return new Date(end.getTime() - 1);
}

function periodBounds(fyStart: Date, periodNumber: number): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(fyStart.getUTCFullYear(), fyStart.getUTCMonth() + (periodNumber - 1), 1, 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0, 0) - 1
  );
  return { start, end };
}

async function ensureCalendar(
  tx: Prisma.TransactionClient,
  organizationId: string,
  date: Date
): Promise<void> {
  const profile = await tx.organizationAccountingProfile.findUnique({
    where: { organizationId },
  });
  const startMonth = profile?.fiscalYearStartMonth ?? 1;
  const start = fiscalYearStart(date, startMonth);

  const existing = await tx.fiscalYear.findUnique({
    where: { organizationId_startDate: { organizationId, startDate: start } },
  });
  if (existing) return;

  const end = fiscalYearEnd(start);
  const name = `FY${start.getUTCFullYear()}`;

  try {
    await tx.fiscalYear.create({
      data: {
        organizationId,
        name,
        startDate: start,
        endDate: end,
        status: FiscalYearStatus.OPEN,
        periods: {
          create: Array.from({ length: 12 }, (_, index) => {
            const { start: pStart, end: pEnd } = periodBounds(start, index + 1);
            return {
              organizationId,
              name: `${pStart.getUTCFullYear()}-${String(pStart.getUTCMonth() + 1).padStart(2, '0')}`,
              periodNumber: index + 1,
              startDate: pStart,
              endDate: pEnd,
              status: PeriodStatus.OPEN,
            };
          }),
        },
      },
    });
  } catch (error) {
    // Concurrent first-post for the same organization/year: another transaction
    // created the calendar. The unique constraint makes this safe to ignore.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return;
    }
    throw error;
  }
}

/**
 * Resolve the accounting period for a posting date.
 *
 * Throws `PERIOD_NOT_FOUND` when the date is outside the generated calendar
 * (only possible for far-future/far-past dates) and `PERIOD_CLOSED` when the
 * resolved period is locked.
 */
export async function resolvePostingPeriod(
  tx: Prisma.TransactionClient,
  organizationId: string,
  postingDate: Date,
  options: ResolvePeriodOptions = {}
): Promise<{ id: string; name: string; status: PeriodStatus; startDate: Date; endDate: Date } | null> {
  if (Number.isNaN(postingDate.getTime())) {
    throw new AppError(400, 'INVALID_POSTING_DATE', 'Posting date is not a valid date');
  }

  await ensureCalendar(tx, organizationId, postingDate);

  const period = await tx.accountingPeriod.findFirst({
    where: {
      organizationId,
      startDate: { lte: postingDate },
      endDate: { gte: postingDate },
    },
  });

  if (!period) {
    if (options.optional) return null;
    throw new AppError(
      400,
      'PERIOD_NOT_FOUND',
      `No accounting period covers ${postingDate.toISOString().slice(0, 10)}`
    );
  }

  if (period.status === PeriodStatus.CLOSED) {
    throw new AppError(
      409,
      'PERIOD_CLOSED',
      `Accounting period ${period.name} is closed. Reopen it or post to an open period.`,
      { periodId: period.id, periodName: period.name }
    );
  }

  if (period.status === PeriodStatus.SOFT_CLOSED && !options.allowSoftClosed) {
    throw new AppError(
      409,
      'PERIOD_SOFT_CLOSED',
      `Accounting period ${period.name} is soft-closed. A privileged adjustment is required.`,
      { periodId: period.id, periodName: period.name }
    );
  }

  return period;
}

/** Current open period for an organization, used as a UI default. */
export async function currentPeriod(organizationId: string) {
  const now = new Date();
  return prisma.$transaction((tx) =>
    resolvePostingPeriod(tx, organizationId, now, { optional: true })
  );
}
