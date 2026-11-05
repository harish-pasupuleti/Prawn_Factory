import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { AppError, conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { pageMeta } from '../../lib/pagination';
import { prisma, type Tx } from '../../lib/prisma';
import { ACTIVE_BOOKING_STATUSES } from '../../lib/stateMachine';
import type { AuthUser } from '../../types/express';

/** Locks one slot row so two simultaneous bookings cannot both take the last place. */
export async function lockSlot(tx: Tx, slotId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "FactorySlot" WHERE "id" = ${slotId}::uuid FOR UPDATE`;
}

export async function bookedCount(tx: Tx | typeof prisma, slotId: string): Promise<number> {
  return tx.slotBooking.count({ where: { slotId, status: { in: [...ACTIVE_BOOKING_STATUSES] } } });
}

type SlotRow = Prisma.FactorySlotGetPayload<Record<string, never>>;
const toDto = (slot: SlotRow, booked: number) => ({
  id: slot.id,
  startsAt: slot.startsAt,
  endsAt: slot.endsAt,
  capacity: slot.capacity,
  isActive: slot.isActive,
  bookedCount: booked,
  available: Math.max(0, slot.capacity - booked),
});

export async function createSlot(actor: AuthUser, input: { startsAt: Date; endsAt: Date; capacity: number }, ip: string | undefined) {
  try {
    return await prisma.$transaction(async (tx) => {
      const slot = await tx.factorySlot.create({ data: { ...input, createdById: actor.id } });
      await recordAudit(tx, { actorId: actor.id, action: 'slot.create', entityType: 'FactorySlot', entityId: slot.id, after: input, ip });
      return toDto(slot, 0);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'SLOT_EXISTS', 'A slot with exactly this start and end already exists');
    throw err;
  }
}

export async function listSlots(query: { page: number; pageSize: number; includePast?: 'true' | 'false'; active?: 'true' | 'false' }) {
  const where: Prisma.FactorySlotWhereInput = {
    ...(query.includePast === 'true' ? {} : { endsAt: { gt: new Date() } }),
    ...(query.active ? { isActive: query.active === 'true' } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.factorySlot.findMany({ where, orderBy: { startsAt: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.factorySlot.count({ where }),
  ]);
  const groups = await prisma.slotBooking.groupBy({
    by: ['slotId'],
    where: { slotId: { in: rows.map((r) => r.id) }, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
    _count: { _all: true },
  });
  const booked = new Map<string, number>(groups.map((g) => [g.slotId, Number(g._count._all)] as [string, number]));
  return { items: rows.map((r) => toDto(r, booked.get(r.id) ?? 0)), meta: pageMeta(query.page, query.pageSize, total) };
}

export async function updateSlot(
  actor: AuthUser,
  id: string,
  input: { capacity?: number | undefined; isActive?: boolean | undefined },
  ip: string | undefined,
) {
  return prisma.$transaction(async (tx) => {
    await lockSlot(tx, id);
    const before = await tx.factorySlot.findUnique({ where: { id } });
    if (!before) throw notFound('Slot not found');
    const booked = await bookedCount(tx, id);
    if (input.capacity !== undefined && input.capacity < booked) {
      throw conflict('CAPACITY_BELOW_BOOKINGS', `${booked} vehicle(s) are already booked in this slot. Capacity cannot be lower.`);
    }
    const data: Prisma.FactorySlotUpdateInput = {};
    if (input.capacity !== undefined) data.capacity = input.capacity;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const after = await tx.factorySlot.update({ where: { id }, data });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'slot.update',
      entityType: 'FactorySlot',
      entityId: id,
      before: { capacity: before.capacity, isActive: before.isActive },
      after: { capacity: after.capacity, isActive: after.isActive },
      ip,
    });
    return toDto(after, booked);
  });
}
