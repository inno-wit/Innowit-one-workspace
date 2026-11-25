import { Prisma, DomainEventStatus } from '@prisma/client';

/**
 * Audit and domain-event writers.
 *
 * Financial mutations must leave two trails:
 *  1. `AuditLog`  — who did what, to which entity, with the change payload.
 *  2. `DomainEventLog` — an outbox row other modules can consume later
 *     (notifications, CRM customer-360, eTIMS orchestration) without the
 *     accounting transaction depending on them.
 *
 * Both are always written inside the caller's transaction so a rolled-back
 * posting leaves no phantom audit trail.
 */

export interface AuditInput {
  organizationId?: string | null;
  branchId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, unknown> | null;
  ipAddress?: string | null;
  correlationId?: string | null;
}

export async function recordAudit(
  tx: Prisma.TransactionClient,
  input: AuditInput
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      branchId: input.branchId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      changesJson: input.changes ? JSON.stringify(input.changes) : null,
      ipAddress: input.ipAddress ?? null,
      correlationId: input.correlationId ?? null,
    },
  });
}

export interface DomainEventInput {
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export async function emitDomainEvent(
  tx: Prisma.TransactionClient,
  input: DomainEventInput
): Promise<void> {
  await tx.domainEventLog.create({
    data: {
      organizationId: input.organizationId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payloadJson: JSON.stringify(input.payload),
      status: DomainEventStatus.PENDING,
    },
  });
}
