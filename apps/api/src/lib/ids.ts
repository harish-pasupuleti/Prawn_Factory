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

/** Generates BOX-<year>-<6 digit number>. Unique across all boxes; numbers are never reused. */
export async function nextBoxNumber(tx: Tx, now = new Date()): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('box_number_seq') AS n`;
  const n = rows[0]?.n;
  if (n === undefined) throw new Error('Could not allocate box number');
  return `BOX-${now.getUTCFullYear()}-${String(n).padStart(6, '0')}`;
}

/** Generates INV-<year>-<6 digit number> for farmer invoices. */
export async function nextInvoiceNumber(tx: Tx, now = new Date()): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
  const n = rows[0]?.n;
  if (n === undefined) throw new Error('Could not allocate invoice number');
  return `INV-${now.getUTCFullYear()}-${String(n).padStart(6, '0')}`;
}
