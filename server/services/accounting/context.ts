import {
  AccountControlType,
  CurrencyCode,
  OrganizationAccountingProfile,
  Prisma,
} from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';

/**
 * Accounting context shared by every Phase 4 service.
 *
 * Posting a business document needs three things that are easy to get wrong:
 *  1. the organization's accounting profile (functional currency, mappings),
 *  2. a GL account for each semantic role (AR, AP, VAT output, ...), resolved
 *     from that profile rather than hardcoded account numbers,
 *  3. a guarantee that every resolved account actually belongs to the tenant.
 *
 * Hardcoded account numbers were one of the pre-Phase-4 defects: an
 * organization that renamed or renumbered its chart silently posted to the
 * wrong account. Resolution now goes through the profile, with a
 * control-type fallback for organizations that have not configured mappings
 * yet, and a hard failure when no account can be resolved. Never guess.
 */

export type MappingKey =
  | 'arControlAccountId'
  | 'apControlAccountId'
  | 'vatOutputAccountId'
  | 'vatInputAccountId'
  | 'whtPayableAccountId'
  | 'suspenseAccountId'
  | 'fxGainAccountId'
  | 'fxLossAccountId'
  | 'retainedEarningsAccountId'
  | 'defaultRevenueAccountId'
  | 'defaultExpenseAccountId'
  | 'defaultCashAccountId';

/**
 * Fallback selector used when the profile mapping is empty. This lets a freshly
 * migrated organization post on day one without an admin step, while still
 * resolving through the chart of accounts instead of a literal number.
 */
const FALLBACK_WHERE: Record<MappingKey, Prisma.AccountWhereInput> = {
  arControlAccountId: { controlType: AccountControlType.CUSTOMER_AR },
  apControlAccountId: { controlType: AccountControlType.SUPPLIER_AP },
  vatOutputAccountId: { controlType: AccountControlType.VAT_OUTPUT },
  vatInputAccountId: { controlType: AccountControlType.VAT_INPUT },
  whtPayableAccountId: { controlType: AccountControlType.WHT_PAYABLE },
  suspenseAccountId: { controlType: AccountControlType.SUSPENSE },
  fxGainAccountId: { controlType: AccountControlType.FX_GAIN_LOSS },
  fxLossAccountId: { controlType: AccountControlType.FX_GAIN_LOSS },
  retainedEarningsAccountId: { controlType: AccountControlType.RETAINED_EARNINGS },
  defaultRevenueAccountId: { type: 'REVENUE' },
  defaultExpenseAccountId: { type: 'EXPENSE' },
  defaultCashAccountId: {
    type: 'ASSET',
    OR: [
      { controlType: AccountControlType.CASH },
      { accountNumber: { in: ['1000', '1010', '1011'] } },
    ],
  },
};

export interface ResolvedAccount {
  id: string;
  accountNumber: string;
  name: string;
  isPostable: boolean;
  isControl: boolean;
  type: string;
}

/** Load (creating on first use) the organization's accounting profile. */
export async function getAccountingProfile(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<OrganizationAccountingProfile> {
  const existing = await tx.organizationAccountingProfile.findUnique({
    where: { organizationId },
  });
  if (existing) return existing;

  try {
    return await tx.organizationAccountingProfile.create({
      data: { organizationId, functionalCurrency: CurrencyCode.KES },
    });
  } catch (error) {
    // Concurrent first use: the unique organizationId makes this safe.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return tx.organizationAccountingProfile.findUniqueOrThrow({ where: { organizationId } });
    }
    throw error;
  }
}

/** Functional (reporting) currency for an organization. */
export async function functionalCurrency(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<CurrencyCode> {
  const profile = await tx.organizationAccountingProfile.findUnique({
    where: { organizationId },
    select: { functionalCurrency: true },
  });
  return profile?.functionalCurrency ?? CurrencyCode.KES;
}

/**
 * Resolve a semantic account role to a real account in this tenant.
 *
 * Throws `ACCOUNT_MAPPING_REQUIRED` rather than falling back to a literal
 * account number: posting to an account the finance team did not choose is
 * worse than refusing to post.
 */
export async function requireMappedAccount(
  tx: Prisma.TransactionClient,
  organizationId: string,
  key: MappingKey,
  options: { requirePostable?: boolean } = {}
): Promise<ResolvedAccount> {
  const profile = await getAccountingProfile(tx, organizationId);
  const mappedId = profile[key] as string | null;

  let account = mappedId
    ? await tx.account.findFirst({
        where: { id: mappedId, organizationId },
        select: {
          id: true,
          accountNumber: true,
          name: true,
          isPostable: true,
          isControl: true,
          type: true,
          isActive: true,
        },
      })
    : null;

  if (mappedId && !account) {
    throw new AppError(
      409,
      'ACCOUNT_MAPPING_INVALID',
      `The account mapped to ${key} does not exist in this organization`
    );
  }

  if (!account) {
    account = await tx.account.findFirst({
      where: {
        organizationId,
        isActive: true,
        ...FALLBACK_WHERE[key],
      },
      orderBy: { accountNumber: 'asc' },
      select: {
        id: true,
        accountNumber: true,
        name: true,
        isPostable: true,
        isControl: true,
        type: true,
        isActive: true,
      },
    });
  }

  if (!account) {
    throw new AppError(
      400,
      'ACCOUNT_MAPPING_REQUIRED',
      `No general ledger account is configured for ${key}. Map it in Accounting Settings before posting.`,
      { mappingKey: key }
    );
  }

  if (!account.isActive) {
    throw new AppError(
      400,
      'ACCOUNT_INACTIVE',
      `Account ${account.accountNumber} (${account.name}) mapped to ${key} is inactive`
    );
  }

  if ((options.requirePostable ?? true) && !account.isPostable) {
    throw new AppError(
      400,
      'ACCOUNT_NOT_POSTABLE',
      `Account ${account.accountNumber} (${account.name}) mapped to ${key} is a summary account`
    );
  }

  return account;
}

/** Resolve an account id and prove it belongs to the tenant. */
export async function requireAccountInOrg(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountId: string,
  label = 'account'
): Promise<ResolvedAccount> {
  const account = await tx.account.findFirst({
    where: { id: accountId, organizationId },
    select: {
      id: true,
      accountNumber: true,
      name: true,
      isPostable: true,
      isControl: true,
      type: true,
      isActive: true,
    },
  });

  if (!account) {
    throw new AppError(403, 'ACCOUNT_NOT_ACCESSIBLE', `The ${label} does not belong to this organization`);
  }
  if (!account.isActive) {
    throw new AppError(400, 'ACCOUNT_INACTIVE', `Account ${account.accountNumber} is inactive`);
  }
  return account;
}
