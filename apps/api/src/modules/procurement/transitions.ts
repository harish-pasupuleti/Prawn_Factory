import type { ProcurementStatus } from '@prisma/client';
import { notFound } from '../../lib/errors';
import type { Tx } from '../../lib/prisma';
import { ACTIVE_COLLECTION_STATUSES, assertTransition } from '../../lib/stateMachine';

/**
 * Moves a request to a new status, validating the transition and recording who/when/why.
 * The caller MUST already hold the request lock (lockRequest) inside the same transaction.
 * Returns the previous status for the audit record.
 */
export async function moveRequest(
  tx: Tx,
  requestId: string,
  to: ProcurementStatus,
  actorId: string,
  reason?: string,
): Promise<ProcurementStatus> {
  const row = await tx.procurementRequest.findUnique({ where: { id: requestId }, select: { status: true } });
  if (!row) throw notFound('Procurement request not found');
  assertTransition(row.status, to);
  await tx.procurementRequest.update({
    where: { id: requestId },
    data: { status: to, statusReason: reason ?? null, statusChangedById: actorId, statusChangedAt: new Date() },
  });
  return row.status;
}

/**
 * Called when an inspection is cleared (PASS, or the manager's PROCEED decision).
 * Transport can be assigned at the same time as the field officer, so if a collection job is already
 * waiting, the request moves straight on to TRANSPORT_ASSIGNED instead of waiting for a second assignment.
 */
export async function advanceIfTransportAssigned(tx: Tx, requestId: string, actorId: string): Promise<void> {
  const job = await tx.collectionJob.findFirst({
    where: { requestId, status: { in: [...ACTIVE_COLLECTION_STATUSES] } },
    select: { id: true },
  });
  if (job) await moveRequest(tx, requestId, 'TRANSPORT_ASSIGNED', actorId);
}
