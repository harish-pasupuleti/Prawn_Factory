import { conflict, isUniqueViolation } from '../../lib/errors';
import { lockRequest } from '../../lib/locks';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../types/express';
import { assignTransportTx } from '../collections/service';
import type { AssignTransportInput } from '../collections/schemas';
import { assignInspectionTx } from '../inspections/service';

/**
 * Purchase Manager assigns the field officer and the transport officer + vehicle in ONE transaction,
 * so transport does not wait for the inspection. Either both are created or neither is.
 */
export async function assignFieldAndTransport(
  actor: AuthUser,
  requestId: string,
  input: { officerId: string; transport: AssignTransportInput },
  ip: string | undefined,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);
      const inspectionId = await assignInspectionTx(tx, actor, requestId, input.officerId, ip);
      const collectionId = await assignTransportTx(tx, actor, requestId, input.transport, ip);
      return { inspectionId, collectionId };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('ASSIGNMENT_CONFLICT', 'An inspection or collection job is already active for this request');
    throw err;
  }
}
