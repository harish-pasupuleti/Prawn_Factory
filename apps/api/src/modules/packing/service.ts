import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { nextBoxNumber } from '../../lib/ids';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { fromGrams, toGrams } from '../../lib/quantity';
import type { AuthUser } from '../../types/express';
import { currentDeclaration } from '../procurement/view';
import type { AddBoxesInput, BoxPlanInput } from './schemas';
import { PACKING_QUEUE_STATUSES, progressFor, requirementKey, weightWithinTolerance } from './rules';

const TERMINAL_REQUEST_STATUSES: string[] = ['REJECTED', 'CANCELLED'];

const packingInclude = {
  request: {
    include: {
      amendments: { orderBy: { seq: 'asc' } },
      boxRequirements: { orderBy: [{ form: 'asc' }, { sizeGrade: 'asc' }, { boxWeightKg: 'asc' }] },
      farmer: { include: { user: { select: { fullName: true } } } },
    },
  },
  queueEntry: { select: { status: true } },
  boxes: { orderBy: [{ packedAt: 'asc' }, { id: 'asc' }], include: { packedBy: { select: { fullName: true } } } },
} satisfies Prisma.ShipmentInclude;

type PackingRow = Prisma.ShipmentGetPayload<{ include: typeof packingInclude }>;

const isPackingStage = (queueStatus: string | undefined): boolean => !!queueStatus && (PACKING_QUEUE_STATUSES as readonly string[]).includes(queueStatus);

function toDto(row: PackingRow) {
  const declaration = currentDeclaration(row.request, row.request.amendments);
  const requirements = row.request.boxRequirements;
  const progress = progressFor(requirements.map((r) => ({ id: r.id, quantity: r.quantity })), row.boxes);
  const live = row.boxes.filter((b) => b.status === 'PACKED');
  const requiredBoxes = requirements.reduce((n, r) => n + r.quantity, 0);
  const packedGrams = live.reduce((n, b) => n + toGrams(b.netWeightKg.toFixed(3)), 0n);
  const queueStatus = row.queueEntry?.status;
  const approved = row.packingApprovedAt !== null;
  return {
    shipment: {
      id: row.id,
      code: row.code,
      status: row.status,
      receivedNetKg: row.netWeightKg?.toFixed(3) ?? null,
      processing: queueStatus ?? null,
      packingApprovedAt: row.packingApprovedAt,
      packingNote: row.packingNote,
    },
    request: { id: row.request.id, code: row.request.code, species: declaration.species, declaredSizeCount: declaration.declaredSizeCount, farmerName: row.request.farmer.user.fullName },
    requirements: requirements.map((r) => {
      const p = progress.find((x) => x.requirementId === r.id)!;
      return { id: r.id, form: r.form, sizeGrade: r.sizeGrade, boxWeightKg: r.boxWeightKg.toFixed(3), quantity: r.quantity, packed: p.packed, remaining: p.remaining };
    }),
    boxes: row.boxes.map((b) => ({
      id: b.id,
      requirementId: b.requirementId,
      form: b.form,
      sizeGrade: b.sizeGrade,
      netWeightKg: b.netWeightKg.toFixed(3),
      status: b.status,
      boxNumber: b.boxNumber,
      numberedAt: b.numberedAt,
      voidReason: b.voidReason,
      packedBy: b.packedBy.fullName,
      packedAt: b.packedAt,
    })),
    summary: {
      requiredBoxes,
      packedBoxes: live.length,
      numberedBoxes: live.filter((b) => b.boxNumber).length,
      unnumberedBoxes: live.filter((b) => !b.boxNumber).length,
      packedWeightKg: fromGrams(packedGrams),
      complete: requirements.length > 0 && progress.every((p) => p.remaining === 0),
    },
    stage: {
      hasPlan: requirements.length > 0,
      // Operators may record boxes while the shipment is processed, until the manager approves the packing.
      open: isPackingStage(queueStatus) && !approved,
      canApprove: queueStatus === 'COMPLETED' && !approved,
      approved,
    },
  };
}

async function loadRow(shipmentId: string): Promise<PackingRow> {
  const row = await prisma.shipment.findUnique({ where: { id: shipmentId }, include: packingInclude, relationLoadStrategy: 'join' });
  if (!row || !isPackingStage(row.queueEntry?.status)) throw notFound('This shipment is not in packing yet');
  return row;
}

export async function getPacking(shipmentId: string) {
  return toDto(await loadRow(shipmentId));
}

/** Shipments that are being processed (or finished) and so are in grading and packing. */
export async function listPacking(query: { page: number; pageSize: number; state?: 'open' | 'approved' | undefined }) {
  const where: Prisma.ShipmentWhereInput = {
    queueEntry: { status: { in: [...PACKING_QUEUE_STATUSES] } },
    ...(query.state === 'approved' ? { packingApprovedAt: { not: null } } : query.state === 'open' ? { packingApprovedAt: null } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.shipment.findMany({
      where,
      include: packingInclude,
      relationLoadStrategy: 'join',
      orderBy: [{ packingApprovedAt: { sort: 'asc', nulls: 'first' } }, { receivedAt: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.shipment.count({ where }),
  ]);
  return {
    items: rows.map((r) => {
      const { shipment, request, summary, stage } = toDto(r);
      return { shipment, request: { id: request.id, code: request.code, species: request.species }, summary, stage };
    }),
    meta: pageMeta(query.page, query.pageSize, total),
  };
}

// ------------------------------------------------------------------ the box plan (purchase manager)

/** What the purchase order requires, as lines of: form, size grade, box weight and number of boxes. */
export async function getBoxPlan(requestId: string) {
  const rows = await prisma.boxRequirement.findMany({ where: { requestId }, orderBy: [{ form: 'asc' }, { sizeGrade: 'asc' }, { boxWeightKg: 'asc' }] });
  return rows.map((r) => ({ id: r.id, form: r.form, sizeGrade: r.sizeGrade, boxWeightKg: r.boxWeightKg.toFixed(3), quantity: r.quantity }));
}

/** Replaces the plan. Lines that already have boxes are kept (their quantity can change, never below what is packed). */
export async function setBoxPlan(actor: AuthUser, requestId: string, input: BoxPlanInput, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const request = await tx.procurementRequest.findUnique({ where: { id: requestId }, select: { status: true, shipments: { select: { packingApprovedAt: true } } } });
    if (!request) throw notFound('Procurement request not found');
    if (TERMINAL_REQUEST_STATUSES.includes(request.status)) throw conflict('INVALID_STATE', 'This request is closed, so its box plan cannot change');
    if (request.shipments.some((s) => s.packingApprovedAt)) throw conflict('PACKING_APPROVED', 'Packing has been approved, so the box plan can no longer change');

    const existing = await tx.boxRequirement.findMany({ where: { requestId }, include: { boxes: { select: { status: true } } } });
    const wanted = new Map(input.lines.map((l) => [requirementKey(l.form, l.sizeGrade, l.boxWeightKg), l]));
    const kept = new Set<string>();

    for (const row of existing) {
      const key = requirementKey(row.form, row.sizeGrade, row.boxWeightKg.toFixed(3));
      const line = wanted.get(key);
      const packed = row.boxes.filter((b) => b.status === 'PACKED').length;
      if (line) {
        kept.add(key);
        if (line.quantity < packed) throw conflict('REQUIREMENT_IN_USE', `${row.sizeGrade} already has ${packed} packed boxes, so the quantity cannot go below that`);
        if (line.quantity !== row.quantity) await tx.boxRequirement.update({ where: { id: row.id }, data: { quantity: line.quantity } });
      } else if (row.boxes.length > 0) {
        throw conflict('REQUIREMENT_IN_USE', `Boxes were already packed for ${row.sizeGrade} ${row.boxWeightKg.toFixed(3)} kg, so that line cannot be removed`);
      } else {
        await tx.boxRequirement.delete({ where: { id: row.id } });
      }
    }
    for (const [key, line] of wanted) {
      if (kept.has(key)) continue;
      await tx.boxRequirement.create({ data: { requestId, form: line.form, sizeGrade: line.sizeGrade, boxWeightKg: line.boxWeightKg, quantity: line.quantity, createdById: actor.id } });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'packing.plan_set',
      entityType: 'ProcurementRequest',
      entityId: requestId,
      after: { lines: input.lines, totalBoxes: input.lines.reduce((n, l) => n + l.quantity, 0) },
      ip,
    });
  });
  return getBoxPlan(requestId);
}

// ------------------------------------------------------------------ packing (factory operator)

async function lockShipment(tx: Prisma.TransactionClient, shipmentId: string) {
  const ref = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { requestId: true } });
  if (!ref) throw notFound('Shipment not found');
  await lockRequest(tx, ref.requestId);
  return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { id: true, code: true, requestId: true, packingApprovedAt: true, queueEntry: { select: { status: true } } } });
}

/** The operator records boxes after grading: which requirement they fill and the actual net weight. */
export async function addBoxes(actor: AuthUser, shipmentId: string, input: AddBoxesInput, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const shipment = await lockShipment(tx, shipmentId);
    if (!isPackingStage(shipment.queueEntry?.status)) throw conflict('PACKING_NOT_OPEN', 'Packing opens once processing has started for this shipment');
    if (shipment.packingApprovedAt) throw conflict('PACKING_APPROVED', 'Packing for this shipment has been approved');

    const requirement = await tx.boxRequirement.findFirst({ where: { id: input.requirementId, requestId: shipment.requestId } });
    if (!requirement) throw badRequest('INVALID_REQUIREMENT', 'Choose one of the boxes on the purchase order');
    if (!weightWithinTolerance(requirement.boxWeightKg.toFixed(3), input.netWeightKg)) {
      throw badRequest('WEIGHT_OUT_OF_TOLERANCE', `The purchase order needs ${requirement.boxWeightKg.toFixed(3)} kg boxes (allowed difference 2%)`);
    }
    const packed = await tx.packedBox.count({ where: { requirementId: requirement.id, shipmentId, status: 'PACKED' } });
    if (packed + input.count > requirement.quantity) {
      throw conflict('REQUIREMENT_FULFILLED', `Only ${Math.max(0, requirement.quantity - packed)} more ${requirement.sizeGrade} box(es) are needed`);
    }
    await tx.packedBox.createMany({
      data: Array.from({ length: input.count }, () => ({ shipmentId, requirementId: requirement.id, form: requirement.form, sizeGrade: requirement.sizeGrade, netWeightKg: input.netWeightKg, packedById: actor.id })),
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'packing.boxes_added',
      entityType: 'Shipment',
      entityId: shipmentId,
      after: { shipmentCode: shipment.code, form: requirement.form, sizeGrade: requirement.sizeGrade, netWeightKg: input.netWeightKg, count: input.count },
      ip,
    });
  });
  return getPacking(shipmentId);
}

// ------------------------------------------------------------------ box numbers, voids and approval (purchase manager)

/** Gives each packed box its unique number. Without a list, every box that has no number yet is numbered, oldest first. */
export async function assignBoxIds(actor: AuthUser, shipmentId: string, boxIds: string[] | undefined, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const shipment = await lockShipment(tx, shipmentId);
    if (shipment.packingApprovedAt) throw conflict('PACKING_APPROVED', 'Packing for this shipment has been approved');
    const boxes = await tx.packedBox.findMany({
      where: { shipmentId, status: 'PACKED', boxNumber: null, ...(boxIds ? { id: { in: boxIds } } : {}) },
      orderBy: [{ packedAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (boxes.length === 0) throw conflict('NOTHING_TO_NUMBER', 'There are no packed boxes waiting for a number');
    const now = new Date();
    const numbers: string[] = [];
    for (const box of boxes) {
      const boxNumber = await nextBoxNumber(tx, now);
      numbers.push(boxNumber);
      await tx.packedBox.update({ where: { id: box.id }, data: { boxNumber, numberedAt: now } });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'packing.ids_assigned',
      entityType: 'Shipment',
      entityId: shipmentId,
      after: { shipmentCode: shipment.code, count: numbers.length, first: numbers[0], last: numbers[numbers.length - 1] },
      ip,
    });
  });
  return getPacking(shipmentId);
}

/** The manager rejects a box that does not meet the order; it stops counting and the operator packs a replacement. */
export async function voidBox(actor: AuthUser, shipmentId: string, boxId: string, reason: string, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const shipment = await lockShipment(tx, shipmentId);
    if (shipment.packingApprovedAt) throw conflict('PACKING_APPROVED', 'Packing for this shipment has been approved');
    const box = await tx.packedBox.findFirst({ where: { id: boxId, shipmentId } });
    if (!box) throw notFound('Box not found');
    if (box.status === 'VOID') throw conflict('ALREADY_VOID', 'This box is already voided');
    await tx.packedBox.update({ where: { id: boxId }, data: { status: 'VOID', voidReason: reason, voidedAt: new Date() } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'packing.box_voided',
      entityType: 'PackedBox',
      entityId: boxId,
      before: { status: box.status, boxNumber: box.boxNumber },
      after: { status: 'VOID', reason, shipmentCode: shipment.code },
      ip,
    });
  });
  return getPacking(shipmentId);
}

/** Signs off the packing: every box is numbered and the order is met, or the manager records why it is accepted short. */
export async function approvePacking(actor: AuthUser, shipmentId: string, note: string | undefined, ip: string | undefined) {
  if (actor.role !== 'PURCHASE_MANAGER') throw forbidden('Only the purchase manager can approve packing');
  await prisma.$transaction(async (tx) => {
    const shipment = await lockShipment(tx, shipmentId);
    if (shipment.packingApprovedAt) throw conflict('PACKING_APPROVED', 'Packing for this shipment has already been approved');
    if (shipment.queueEntry?.status !== 'COMPLETED') throw conflict('PROCESSING_NOT_COMPLETE', 'Packing can be approved once processing is completed');

    const [requirements, boxes] = await Promise.all([
      tx.boxRequirement.findMany({ where: { requestId: shipment.requestId } }),
      tx.packedBox.findMany({ where: { shipmentId, status: 'PACKED' }, select: { requirementId: true, status: true, boxNumber: true } }),
    ]);
    if (requirements.length === 0) throw conflict('BOX_PLAN_REQUIRED', 'Set the box requirements for this order first');
    if (boxes.length === 0) throw conflict('NO_BOXES', 'No boxes have been packed yet');
    if (boxes.some((b) => !b.boxNumber)) throw conflict('BOXES_NOT_NUMBERED', 'Give every packed box its number before approving');

    const shortfalls = progressFor(requirements.map((r) => ({ id: r.id, quantity: r.quantity })), boxes)
      .filter((p) => p.remaining > 0)
      .map((p) => {
        const r = requirements.find((x) => x.id === p.requirementId)!;
        return { form: r.form, sizeGrade: r.sizeGrade, boxWeightKg: r.boxWeightKg.toFixed(3), missing: p.remaining };
      });
    if (shortfalls.length > 0 && (!note || note.length < 5)) {
      throw conflict('PACKING_INCOMPLETE', `The order is not fully packed (${shortfalls.map((s) => `${s.missing} x ${s.sizeGrade}`).join(', ')} missing). Add a note to accept it as it is.`);
    }
    await tx.shipment.update({ where: { id: shipmentId }, data: { packingApprovedAt: new Date(), packingNote: note ?? null } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'packing.approved',
      entityType: 'Shipment',
      entityId: shipmentId,
      after: { shipmentCode: shipment.code, boxes: boxes.length, shortfalls, note: note ?? null },
      ip,
    });
  });
  return getPacking(shipmentId);
}
