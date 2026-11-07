import type { ProcurementStatus } from '@prisma/client';
import { notFound } from '../../lib/errors';
import type { Tx } from '../../lib/prisma';
import { assertTransition } from '../../lib/stateMachine';

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
