import type { Tx } from './prisma';

/** Generates PR-<year>-<6 digit number> from a PostgreSQL sequence (unique, gap-tolerant). */
export async function nextProcurementCode(tx: Tx, now = new Date()): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('procurement_code_seq') AS n`;
  const n = rows[0]?.n;
  if (n === undefined) throw new Error('Could not allocate procurement code');
  return `PR-${now.getUTCFullYear()}-${String(n).padStart(6, '0')}`;
}

/** Generates SH-<year>-<6 digit number> from a PostgreSQL sequence. */
export async function nextShipmentCode(tx: Tx, now = new Date()): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('shipment_code_seq') AS n`;
  const n = rows[0]?.n;
  if (n === undefined) throw new Error('Could not allocate shipment code');
  return `SH-${now.getUTCFullYear()}-${String(n).padStart(6, '0')}`;
}
