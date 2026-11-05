import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { AppError, conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { pageMeta } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { ACTIVE_COLLECTION_STATUSES } from '../../lib/stateMachine';

const vehicleSelect = {
  id: true,
  registrationNumber: true,
  description: true,
  capacityKg: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.VehicleSelect;

type VehicleRow = Prisma.VehicleGetPayload<{ select: typeof vehicleSelect }>;

const toDto = (v: VehicleRow, busy: boolean) => ({ ...v, capacityKg: v.capacityKg.toFixed(3), busy });

export async function createVehicle(
  actorId: string,
  input: { registrationNumber: string; description?: string | undefined; capacityKg: string },
  ip: string | undefined,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: { registrationNumber: input.registrationNumber, description: input.description ?? null, capacityKg: input.capacityKg },
        select: vehicleSelect,
      });
      await recordAudit(tx, {
        actorId,
        action: 'vehicle.create',
        entityType: 'Vehicle',
        entityId: vehicle.id,
        after: vehicle,
        ip,
      });
      return toDto(vehicle, false);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'VEHICLE_EXISTS', 'A vehicle with this registration number already exists');
    throw err;
  }
}

export async function listVehicles(query: { page: number; pageSize: number; active?: 'true' | 'false' }) {
  const where: Prisma.VehicleWhereInput = query.active ? { isActive: query.active === 'true' } : {};
  const [rows, total] = await prisma.$transaction([
    prisma.vehicle.findMany({
      where,
      select: vehicleSelect,
      orderBy: { registrationNumber: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.vehicle.count({ where }),
  ]);
  const busy = await prisma.collectionJob.findMany({
    where: { vehicleId: { in: rows.map((r) => r.id) }, status: { in: [...ACTIVE_COLLECTION_STATUSES] } },
    select: { vehicleId: true },
  });
  const busyIds = new Set(busy.map((b) => b.vehicleId));
  return { items: rows.map((r) => toDto(r, busyIds.has(r.id))), meta: pageMeta(query.page, query.pageSize, total) };
}

export async function updateVehicle(
  actorId: string,
  id: string,
  input: { description?: string | undefined; capacityKg?: string | undefined; isActive?: boolean | undefined },
  ip: string | undefined,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.vehicle.findUnique({ where: { id }, select: vehicleSelect });
    if (!before) throw notFound('Vehicle not found');

    if (input.isActive === false && before.isActive) {
      const active = await tx.collectionJob.count({ where: { vehicleId: id, status: { in: [...ACTIVE_COLLECTION_STATUSES] } } });
      if (active > 0) throw conflict('VEHICLE_BUSY', 'This vehicle has an active collection job and cannot be deactivated yet');
    }

    const data: Prisma.VehicleUpdateInput = {};
    if (input.description !== undefined) data.description = input.description || null;
    if (input.capacityKg !== undefined) data.capacityKg = input.capacityKg;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const after = await tx.vehicle.update({ where: { id }, data, select: vehicleSelect });

    await recordAudit(tx, { actorId, action: 'vehicle.update', entityType: 'Vehicle', entityId: id, before, after, ip });
    return toDto(after, false);
  });
}
