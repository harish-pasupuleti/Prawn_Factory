import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { nextInvoiceNumber } from '../../lib/ids';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../types/express';
import { currentDeclaration } from '../procurement/view';
import { computeAmountInr, type PaymentState } from './rules';
import type { z } from 'zod';
import type { decidePaymentSchema, settlePaymentSchema } from './schemas';

type DecideInput = z.infer<typeof decidePaymentSchema>;
type SettleInput = z.infer<typeof settlePaymentSchema>;

const paymentInclude = {
  payment: { include: { decidedBy: { select: { fullName: true } } } },
  queueEntry: { select: { status: true } },
  collectionJob: { select: { status: true, collectedQuantityKg: true, handedOverAt: true } },
  request: {
    include: {
      amendments: { orderBy: { seq: 'asc' } },
      farmer: { include: { user: { select: { fullName: true, email: true } } } },
    },
  },
} satisfies Prisma.ShipmentInclude;

type Row = Prisma.ShipmentGetPayload<{ include: typeof paymentInclude }>;

const isStaff = (actor: AuthUser) => actor.role !== 'FARMER';

/** Farmers see only their own deliveries. */
function scopeFor(actor: AuthUser): Prisma.ShipmentWhereInput {
  const delivered: Prisma.ShipmentWhereInput = { collectionJob: { status: 'HANDED_OVER' } };
  return actor.role === 'FARMER' ? { ...delivered, request: { farmer: { userId: actor.id } } } : delivered;
}

/**
 * Pay on the weight the factory recorded when there is one, otherwise on the quantity the transport officer
 * collected from the farmer. The rate is the agreed price per kg (the current declaration).
 */
function basis(row: Row): { quantityKg: string; quantityBasis: 'FACTORY_WEIGHT' | 'COLLECTED_QUANTITY'; ratePerKg: string } {
  const declaration = currentDeclaration(row.request, row.request.amendments);
  const factory = row.netWeightKg?.toFixed(3);
  return {
    quantityKg: factory ?? row.collectionJob.collectedQuantityKg?.toFixed(3) ?? declaration.declaredQuantityKg,
    quantityBasis: factory ? 'FACTORY_WEIGHT' : 'COLLECTED_QUANTITY',
    ratePerKg: declaration.expectedPriceInrPerKg,
  };
}

function stateOf(row: Row): PaymentState {
  if (!row.payment) return 'AWAITING_DECISION';
  return row.payment.status === 'PAID' ? 'PAID' : 'PAY_LATER';
}

function toDto(row: Row, actor: AuthUser) {
  const declaration = currentDeclaration(row.request, row.request.amendments);
  const state = stateOf(row);
  const b = basis(row);
  const p = row.payment;
  const processingCompleted = row.queueEntry?.status === 'COMPLETED';
  return {
    shipmentId: row.id,
    shipmentCode: row.code,
    request: {
      id: row.request.id,
      code: row.request.code,
      species: declaration.species,
      declaredSizeCount: declaration.declaredSizeCount,
      ...(isStaff(actor) ? { farmerName: row.request.farmer.user.fullName } : {}),
    },
    deliveredAt: row.collectionJob.handedOverAt,
    state,
    option: p?.option ?? null,
    processingCompleted,
    // Pay Later turns into a payment the manager can make once processing is completed.
    canSettle: state === 'PAY_LATER' && processingCompleted,
    estimate: { ...b, amountInr: computeAmountInr(b.quantityKg, b.ratePerKg) },
    decidedAt: p?.decidedAt ?? null,
    invoice:
      p && p.status === 'PAID' && p.invoiceNumber
        ? {
            invoiceNumber: p.invoiceNumber,
            invoicedAt: p.invoicedAt,
            paidAt: p.paidAt,
            quantityKg: p.quantityKg?.toFixed(3) ?? null,
            quantityBasis: p.quantityBasis,
            ratePerKg: p.ratePerKg?.toFixed(2) ?? null,
            amountInr: p.amountInr?.toFixed(2) ?? null,
            method: p.method,
            reference: p.reference,
            paidBy: p.decidedBy.fullName,
            farmer: { name: row.request.farmer.user.fullName, email: row.request.farmer.user.email },
          }
        : null,
  };
}

export async function listPayments(actor: AuthUser, query: { page: number; pageSize: number; state?: PaymentState | undefined; requestId?: string | undefined }) {
  const where: Prisma.ShipmentWhereInput = {
    ...scopeFor(actor),
    ...(query.requestId ? { requestId: query.requestId } : {}),
    ...(query.state === 'AWAITING_DECISION' ? { payment: { is: null } } : query.state ? { payment: { is: { status: query.state } } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.shipment.findMany({
      where,
      include: paymentInclude,
      relationLoadStrategy: 'join',
      orderBy: [{ collectionJob: { handedOverAt: 'desc' } }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.shipment.count({ where }),
  ]);
  return { items: rows.map((r) => toDto(r, actor)), meta: pageMeta(query.page, query.pageSize, total) };
}

export async function getPayment(actor: AuthUser, shipmentId: string) {
  const row = await prisma.shipment.findFirst({ where: { id: shipmentId, ...scopeFor(actor) }, include: paymentInclude, relationLoadStrategy: 'join' });
  if (!row) throw notFound('Payment not found');
  return toDto(row, actor);
}

async function loadForUpdate(tx: Prisma.TransactionClient, shipmentId: string) {
  const ref = await tx.shipment.findFirst({ where: { id: shipmentId, collectionJob: { status: 'HANDED_OVER' } }, select: { requestId: true } });
  // Payment is only possible once the transport officer has handed the prawns over at the factory.
  if (!ref) throw conflict('NOT_DELIVERED', 'Payment can be decided once the transport officer has delivered the prawns to the factory');
  await lockRequest(tx, ref.requestId);
  return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: paymentInclude });
}

/** Writes the invoice details onto a payment row. */
async function invoiceData(tx: Prisma.TransactionClient, row: Row, input: { method?: string | undefined; reference?: string | undefined }) {
  const b = basis(row);
  const now = new Date();
  return {
    status: 'PAID' as const,
    invoiceNumber: await nextInvoiceNumber(tx, now),
    invoicedAt: now,
    paidAt: now,
    quantityKg: b.quantityKg,
    quantityBasis: b.quantityBasis,
    ratePerKg: b.ratePerKg,
    amountInr: computeAmountInr(b.quantityKg, b.ratePerKg),
    method: input.method ?? null,
    reference: input.reference ?? null,
  };
}

/** Purchase manager chooses Pay Now (invoice is made and paid now) or Pay Later (after processing is completed). */
export async function decidePayment(actor: AuthUser, shipmentId: string, input: DecideInput, ip: string | undefined) {
  try {
    await prisma.$transaction(async (tx) => {
      const row = await loadForUpdate(tx, shipmentId);
      if (row.payment) throw conflict('ALREADY_DECIDED', 'A payment option has already been chosen for this delivery');
      const invoice = input.option === 'PAY_NOW' ? await invoiceData(tx, row, input) : null;
      const created = await tx.payment.create({
        data: {
          shipmentId,
          requestId: row.requestId,
          option: input.option,
          decidedById: actor.id,
          ...(invoice ?? { status: 'PAY_LATER' as const }),
        },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: input.option === 'PAY_NOW' ? 'payment.pay_now' : 'payment.pay_later',
        entityType: 'Payment',
        entityId: created.id,
        after: { shipmentCode: row.code, option: input.option, invoiceNumber: invoice?.invoiceNumber ?? null, amountInr: invoice?.amountInr ?? null },
        ip,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('ALREADY_DECIDED', 'A payment option has already been chosen for this delivery');
    throw err;
  }
  return getPayment(actor, shipmentId);
}

/** Pay Later becomes a payment, with its invoice, once processing is completed. */
export async function settlePayment(actor: AuthUser, shipmentId: string, input: SettleInput, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const row = await loadForUpdate(tx, shipmentId);
    if (!row.payment) throw conflict('NOT_DECIDED', 'Choose Pay Now or Pay Later first');
    if (row.payment.status === 'PAID') throw conflict('ALREADY_PAID', 'This delivery has already been paid');
    if (row.queueEntry?.status !== 'COMPLETED') throw conflict('PROCESSING_NOT_COMPLETE', 'Pay Later payments can be made once processing is completed');
    const invoice = await invoiceData(tx, row, input);
    await tx.payment.update({ where: { shipmentId }, data: invoice });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'payment.settled',
      entityType: 'Payment',
      entityId: row.payment.id,
      before: { status: 'PAY_LATER' },
      after: { shipmentCode: row.code, invoiceNumber: invoice.invoiceNumber, amountInr: invoice.amountInr },
      ip,
    });
  });
  return getPayment(actor, shipmentId);
}
