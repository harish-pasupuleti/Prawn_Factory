import { recordAudit } from '../../lib/audit';
import { AppError, conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../types/express';

export async function createStation(actor: AuthUser, name: string, ip: string | undefined) {
  try {
    return await prisma.$transaction(async (tx) => {
      const station = await tx.processingStation.create({ data: { name } });
      await recordAudit(tx, { actorId: actor.id, action: 'station.create', entityType: 'ProcessingStation', entityId: station.id, after: { name }, ip });
      return { id: station.id, name: station.name, isActive: station.isActive, busy: false };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'STATION_EXISTS', 'A station with this name already exists');
    throw err;
  }
}

export async function listStations() {
  const stations = await prisma.processingStation.findMany({ orderBy: { name: 'asc' } });
  const running = await prisma.queueEntry.findMany({ where: { status: 'IN_PROGRESS', stationId: { in: stations.map((s) => s.id) } }, select: { stationId: true } });
  const busy = new Set(running.map((r) => r.stationId));
  return stations.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive, busy: busy.has(s.id) }));
}

export async function updateStation(
  actor: AuthUser,
  id: string,
  input: { name?: string | undefined; isActive?: boolean | undefined },
  ip: string | undefined,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.processingStation.findUnique({ where: { id } });
      if (!before) throw notFound('Station not found');
      if (input.isActive === false && before.isActive) {
        const running = await tx.queueEntry.count({ where: { stationId: id, status: 'IN_PROGRESS' } });
        if (running > 0) throw conflict('STATION_BUSY', 'This station is processing a shipment and cannot be deactivated yet');
      }
      const after = await tx.processingStation.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'station.update',
        entityType: 'ProcessingStation',
        entityId: id,
        before: { name: before.name, isActive: before.isActive },
        after: { name: after.name, isActive: after.isActive },
        ip,
      });
      return { id: after.id, name: after.name, isActive: after.isActive, busy: false };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'STATION_EXISTS', 'A station with this name already exists');
    throw err;
  }
}
