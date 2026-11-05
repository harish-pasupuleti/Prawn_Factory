import type { Tx } from './prisma';

/**
 * Locks the request row until the transaction ends. Every mutation that touches a request, its
 * inspections or its collection jobs takes this lock first, so concurrent actions on one request
 * are serialised and always acquire locks in the same order (no deadlocks).
 */
export async function lockRequest(tx: Tx, requestId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "ProcurementRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
}
