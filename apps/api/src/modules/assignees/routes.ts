import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ACTIVE_COLLECTION_STATUSES, ACTIVE_INSPECTION_STATUSES } from '../../lib/stateMachine';
import { authenticate, requireRole } from '../../middleware/auth';

const querySchema = z.object({ role: z.enum(['FIELD_OFFICER', 'TRANSPORT_OFFICER']) });

/**
 * Minimal directory for the Purchase Manager's assignment pickers: id, name and current workload only.
 * No emails or other personal data are exposed.
 */
export function assigneesRouter(): Router {
  const router = Router();
  router.use(authenticate, requireRole('PURCHASE_MANAGER'));

  router.get('/', async (req, res) => {
    const { role } = querySchema.parse(req.query);
    const users = await prisma.user.findMany({
      where: { role, status: 'ACTIVE' },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    const ids = users.map((u) => u.id);
    const counts =
      role === 'FIELD_OFFICER'
        ? (
            await prisma.fieldInspection.groupBy({
              by: ['officerId'],
              where: { officerId: { in: ids }, status: { in: [...ACTIVE_INSPECTION_STATUSES] } },
              _count: { _all: true },
            })
          ).map((g) => [g.officerId, g._count._all] as const)
        : (
            await prisma.collectionJob.groupBy({
              by: ['transportOfficerId'],
              where: { transportOfficerId: { in: ids }, status: { in: [...ACTIVE_COLLECTION_STATUSES] } },
              _count: { _all: true },
            })
          ).map((g) => [g.transportOfficerId, g._count._all] as const);
    const activeById = new Map(counts);
    res.json({ data: users.map((u) => ({ id: u.id, fullName: u.fullName, activeCount: activeById.get(u.id) ?? 0 })) });
  });

  return router;
}
