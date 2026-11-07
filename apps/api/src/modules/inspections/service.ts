import type { InspectionOutcome, InspectionStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { fixed } from '../../lib/decimal';
import { recordAudit } from '../../lib/audit';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../../lib/errors';
import { lockRequest } from '../../lib/locks';
import { pageMeta } from '../../lib/pagination';
import { prisma, type Tx } from '../../lib/prisma';
import { exceedsVariance, varianceHundredths } from '../../lib/quantity';
import { assertInspectionTransition } from '../../lib/stateMachine';
import type { AuthUser } from '../../types/express';
import { moveRequest } from '../procurement/transitions';
import { currentDeclaration } from '../procurement/view';
import type { CompleteInspectionInput } from './schemas';

const inspectionInclude = {
  officer: { select: { fullName: true } },
  decision: { include: { decidedBy: { select: { fullName: true } } } },
  request: {
    include: {
      amendments: { orderBy: { seq: 'asc' } },
      farmer: { include: { user: { select: { fullName: true } } } },
    },
  },
} satisfies Prisma.FieldInspectionInclude;

type InspectionRow = Prisma.FieldInspectionGetPayload<{ include: typeof inspectionInclude }>;

/** Field officers see only their own inspections; the manager and administrator see all. */
function scopeFor(actor: AuthUser): Prisma.FieldInspectionWhereInput {
  if (actor.role === 'FIELD_OFFICER') return { officerId: actor.id };
  if (actor.role === 'PURCHASE_MANAGER' || actor.role === 'ADMIN') return {};
  throw forbidden();
}

function toDto(row: InspectionRow) {
  // The officer needs the declaration and farmer contact to do the job, but not the farmer's expected price.
  const { expectedPriceInrPerKg: _price, ...declaration } = currentDeclaration(row.request, row.request.amendments);
  return {
    id: row.id,
    status: row.status,
    outcome: row.outcome,
    assignedAt: row.assignedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    officer: { name: row.officer.fullName },
    request: {
      id: row.request.id,
      code: row.request.code,
      status: row.request.status,
      declaration,
      farmer: {
        name: row.request.farmer.user.fullName,
        phone: row.request.farmer.phone,
        village: row.request.farmer.village,
        district: row.request.farmer.district,
        state: row.request.farmer.state,
      },
    },
    observedSpecies: row.observedSpecies,
    observedSizeCount: row.observedSizeCount,
    inspectedQuantityKg: fixed(row.inspectedQuantityKg, 3),
    declaredQuantityKgAtInspection: fixed(row.declaredQuantityKgAtInspection, 3),
    quantityVariancePct: fixed(row.quantityVariancePct, 2),
    qualityNotes: row.qualityNotes,
    discrepancyNotes: row.discrepancyNotes,
    cancelReason: row.cancelReason,
    decision: row.decision
      ? { kind: row.decision.kind, reason: row.decision.reason, by: row.decision.decidedBy.fullName, at: row.decision.createdAt }
      : null,
  };
}

export async function getInspection(actor: AuthUser, id: string) {
  const row = await prisma.fieldInspection.findFirst({ where: { id, ...scopeFor(actor) }, include: inspectionInclude, relationLoadStrategy: 'join' });
  if (!row) throw notFound('Inspection not found');
  return toDto(row);
}

export async function listInspections(
  actor: AuthUser,
  query: { page: number; pageSize: number; status?: InspectionStatus; outcome?: InspectionOutcome },
) {
  const where: Prisma.FieldInspectionWhereInput = {
    ...scopeFor(actor),
    ...(query.status ? { status: query.status } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.fieldInspection.findMany({
      where,
      include: inspectionInclude,
      relationLoadStrategy: 'join',
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.fieldInspection.count({ where }),
  ]);
  return { items: rows.map(toDto), meta: pageMeta(query.page, query.pageSize, total) };
}

/** Assigns a field officer to an APPROVED request. The caller holds the request lock inside the same transaction. */
export async function assignInspectionTx(tx: Tx, actor: AuthUser, requestId: string, officerId: string, ip: string | undefined): Promise<string> {
  // Validates that the request is APPROVED (otherwise 409 INVALID_TRANSITION).
  const from = await moveRequest(tx, requestId, 'INSPECTION_ASSIGNED', actor.id);
  const officer = await tx.user.findFirst({
    where: { id: officerId, role: 'FIELD_OFFICER', status: 'ACTIVE' },
    select: { id: true },
  });
  if (!officer) throw badRequest('INVALID_ASSIGNEE', 'Choose an active field officer');

  const created = await tx.fieldInspection.create({
    data: { requestId, officerId, assignedById: actor.id },
    select: { id: true },
  });
  await recordAudit(tx, {
    actorId: actor.id,
    action: 'inspection.assign',
    entityType: 'FieldInspection',
    entityId: created.id,
    before: { requestStatus: from },
    after: { requestId, officerId, requestStatus: 'INSPECTION_ASSIGNED' },
    ip,
  });
  return created.id;
}

/** Purchase Manager assigns an active field officer to an APPROVED request. */
export async function assignInspection(actor: AuthUser, requestId: string, officerId: string, ip: string | undefined) {
  try {
    const id = await prisma.$transaction(async (tx) => {
      await lockRequest(tx, requestId);
      return assignInspectionTx(tx, actor, requestId, officerId, ip);
    });
    return await getInspection(actor, id);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('ASSIGNMENT_CONFLICT', 'An inspection is already active for this request');
    throw err;
  }
}

export async function startInspection(actor: AuthUser, id: string, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const ref = await tx.fieldInspection.findFirst({ where: { id, officerId: actor.id }, select: { requestId: true } });
    if (!ref) throw notFound('Inspection not found');
    await lockRequest(tx, ref.requestId);
    const inspection = await tx.fieldInspection.findUniqueOrThrow({ where: { id } });
    assertInspectionTransition(inspection.status, 'IN_PROGRESS');
    await tx.fieldInspection.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'inspection.start',
      entityType: 'FieldInspection',
      entityId: id,
      before: { status: inspection.status },
      after: { status: 'IN_PROGRESS' },
      ip,
    });
  });
  return getInspection(actor, id);
}

const OUTCOME_TARGET = {
  PASS: 'INSPECTION_PASSED',
  FAIL: 'INSPECTION_FAILED',
  REVIEW: 'INSPECTION_REVIEW',
} as const;

export async function completeInspection(actor: AuthUser, id: string, input: CompleteInspectionInput, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const ref = await tx.fieldInspection.findFirst({ where: { id, officerId: actor.id }, select: { requestId: true } });
    if (!ref) throw notFound('Inspection not found');
    await lockRequest(tx, ref.requestId);

    const inspection = await tx.fieldInspection.findUniqueOrThrow({ where: { id } });
    assertInspectionTransition(inspection.status, 'COMPLETED');

    // Compare against what the farmer CURRENTLY declares (original + amendments). Nothing is overwritten.
    const request = await tx.procurementRequest.findUniqueOrThrow({
      where: { id: ref.requestId },
      include: { amendments: { orderBy: { seq: 'asc' } } },
    });
    const declared = currentDeclaration(request, request.amendments);
    const variance = varianceHundredths(declared.declaredQuantityKg, input.inspectedQuantityKg);
    const quantityOff = exceedsVariance(declared.declaredQuantityKg, input.inspectedQuantityKg, env.QUANTITY_VARIANCE_THRESHOLD_PCT);
    const speciesOff = input.observedSpecies.trim().toLowerCase() !== declared.species.trim().toLowerCase();

    if (input.outcome === 'PASS' && (quantityOff || speciesOff) && (input.discrepancyNotes ?? '').length < 3) {
      throw badRequest(
        'DISCREPANCY_NOTES_REQUIRED',
        'The findings differ from the declaration. Explain the discrepancy before passing this inspection.',
        { quantityOff, speciesOff, thresholdPct: env.QUANTITY_VARIANCE_THRESHOLD_PCT },
      );
    }

    await tx.fieldInspection.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        outcome: input.outcome,
        observedSpecies: input.observedSpecies,
        observedSizeCount: input.observedSizeCount,
        inspectedQuantityKg: input.inspectedQuantityKg,
        declaredQuantityKgAtInspection: declared.declaredQuantityKg,
        quantityVariancePct: variance === null ? null : (Number(variance) / 100).toFixed(2),
        qualityNotes: input.qualityNotes,
        discrepancyNotes: input.discrepancyNotes ? input.discrepancyNotes : null,
      },
    });

    const reasonForFarmer = input.outcome === 'PASS' ? undefined : input.discrepancyNotes || input.qualityNotes;
    const from = await moveRequest(tx, ref.requestId, OUTCOME_TARGET[input.outcome], actor.id, reasonForFarmer);

    await recordAudit(tx, {
      actorId: actor.id,
      action: 'inspection.complete',
      entityType: 'FieldInspection',
      entityId: id,
      before: { status: inspection.status, requestStatus: from },
      after: {
        status: 'COMPLETED',
        outcome: input.outcome,
        requestStatus: OUTCOME_TARGET[input.outcome],
        declaredQuantityKg: declared.declaredQuantityKg,
        inspectedQuantityKg: input.inspectedQuantityKg,
        quantityOff,
        speciesOff,
      },
      ip,
    });
  });
  return getInspection(actor, id);
}

const DECISION_TARGET = { PROCEED: 'INSPECTION_PASSED', REJECT: 'REJECTED', REINSPECT: 'APPROVED' } as const;

/**
 * Purchase Manager's explicit, audited decision on a FAIL or REVIEW inspection.
 * Without one, the request stays blocked and can never reach transport.
 */
export async function decideInspection(
  actor: AuthUser,
  id: string,
  input: { decision: keyof typeof DECISION_TARGET; reason: string },
  ip: string | undefined,
) {
  await prisma.$transaction(async (tx) => {
    const ref = await tx.fieldInspection.findUnique({ where: { id }, select: { requestId: true } });
    if (!ref) throw notFound('Inspection not found');
    await lockRequest(tx, ref.requestId);

    const inspection = await tx.fieldInspection.findUniqueOrThrow({ where: { id }, include: { decision: true } });
    if (inspection.status !== 'COMPLETED' || (inspection.outcome !== 'FAIL' && inspection.outcome !== 'REVIEW')) {
      throw conflict('DECISION_NOT_APPLICABLE', 'Only a completed FAIL or REVIEW inspection needs a decision');
    }
    if (inspection.decision) throw conflict('ALREADY_DECIDED', 'A decision has already been recorded for this inspection');

    const target = DECISION_TARGET[input.decision];
    const from = await moveRequest(tx, ref.requestId, target, actor.id, input.reason);
    await tx.inspectionDecision.create({
      data: { requestId: ref.requestId, inspectionId: id, kind: input.decision, reason: input.reason, decidedById: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'inspection.decision',
      entityType: 'FieldInspection',
      entityId: id,
      before: { outcome: inspection.outcome, requestStatus: from },
      after: { decision: input.decision, reason: input.reason, requestStatus: target },
      ip,
    });
  });
  return getInspection(actor, id);
}

/** Purchase Manager withdraws an assignment that has not been completed; the request returns to APPROVED. */
export async function cancelInspection(actor: AuthUser, id: string, reason: string, ip: string | undefined) {
  await prisma.$transaction(async (tx) => {
    const ref = await tx.fieldInspection.findUnique({ where: { id }, select: { requestId: true } });
    if (!ref) throw notFound('Inspection not found');
    await lockRequest(tx, ref.requestId);

    const inspection = await tx.fieldInspection.findUniqueOrThrow({ where: { id } });
    assertInspectionTransition(inspection.status, 'CANCELLED');
    await tx.fieldInspection.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
    const from = await moveRequest(tx, ref.requestId, 'APPROVED', actor.id, `Inspection assignment cancelled: ${reason}`);
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'inspection.cancel',
      entityType: 'FieldInspection',
      entityId: id,
      before: { status: inspection.status, requestStatus: from },
      after: { status: 'CANCELLED', reason, requestStatus: 'APPROVED' },
      ip,
    });
  });
  return getInspection(actor, id);
}
