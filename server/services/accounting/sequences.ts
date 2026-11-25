import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';

/**
 * Atomic document numbering.
 *
 * Journal numbers were previously supplied by the client, which made duplicate
 * posting possible and let callers choose their own sequence. Numbers are now
 * allocated inside the same transaction as the document they belong to, using a
 * single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement so two
 * concurrent posts can never share a number.
 */

export type SequencePrefix = 'JE' | 'INV' | 'RCPT' | 'BILL' | 'PAY' | 'CN' | 'BANK';

export interface AllocateNumberInput {
  organizationId: string;
  prefix: SequencePrefix;
  /** Branch id or other partition; defaults to GLOBAL. */
  scope?: string;
  year?: number;
  /** Optional textual padding, e.g. 4 -> "0001". */
  pad?: number;
}

/**
 * Allocate the next number for a prefix and return the formatted document
 * reference, e.g. `JE-2026-0001`.
 *
 * MUST be called with an explicit transaction client: a sequence allocated
 * outside the posting transaction would leak gaps on rollback and would not be
 * serialised against a concurrent post.
 */
export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  input: AllocateNumberInput
): Promise<string> {
  const scope = input.scope ?? 'GLOBAL';
  const year = input.year ?? new Date().getFullYear();
  const pad = input.pad ?? 4;

  const rows = await tx.$queryRaw<Array<{ nextValue: number }>>`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "prefix", "scope", "year", "nextValue", "updatedAt")
    VALUES (gen_random_uuid(), ${input.organizationId}, ${input.prefix}, ${scope}, ${year}, 2, now())
    ON CONFLICT ("organizationId", "prefix", "scope", "year")
    DO UPDATE SET "nextValue" = "DocumentSequence"."nextValue" + 1,
                  "updatedAt" = now()
    RETURNING "nextValue"
  `;

  const next = rows[0]?.nextValue;
  if (!next) {
    throw new Error(`Failed to allocate document number for prefix ${input.prefix}`);
  }

  const allocated = next - 1;
  return `${input.prefix}-${year}-${String(allocated).padStart(pad, '0')}`;
}

/**
 * Read the next value without consuming it. Used by UI previews only; never
 * use this to build a document reference.
 */
export async function peekNextNumber(
  organizationId: string,
  prefix: SequencePrefix,
  scope = 'GLOBAL',
  year = new Date().getFullYear()
): Promise<string> {
  const row = await prisma.documentSequence.findUnique({
    where: {
      organizationId_prefix_scope_year: { organizationId, prefix, scope, year },
    },
  });
  const next = row?.nextValue ?? 1;
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}
