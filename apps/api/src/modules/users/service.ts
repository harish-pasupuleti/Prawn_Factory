import type { Prisma, Role, UserStatus } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { pageMeta } from '../../lib/pagination';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { invalidateAuthCache } from '../../middleware/auth';
import { publicUserSelect, revokeUserSessions } from '../auth/service';

export async function createStaffUser(
  actorId: string,
  input: { email: string; password: string; fullName: string; role: Exclude<Role, 'FARMER'> },
  ip: string | undefined,
) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, passwordHash, fullName: input.fullName, role: input.role },
        select: publicUserSelect,
      });
      await recordAudit(tx, {
        actorId,
        action: 'user.create',
        entityType: 'User',
        entityId: user.id,
        after: { email: user.email, role: user.role, status: user.status },
        ip,
      });
      return user;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    throw err;
  }
}

export async function listUsers(query: {
  page: number;
  pageSize: number;
  role?: Role;
  status?: UserStatus;
  q?: string;
}) {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' } },
            { fullName: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: publicUserSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return { items, meta: pageMeta(query.page, query.pageSize, total) };
}

export async function updateUser(
  actorId: string,
  targetId: string,
  input: { fullName?: string; role?: Role; status?: UserStatus },
  ip: string | undefined,
) {
  if (targetId === actorId && (input.role !== undefined || input.status !== undefined)) {
    throw conflict('CANNOT_MODIFY_SELF', 'Administrators cannot change their own role or status');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: targetId }, select: publicUserSelect });
    if (!before) throw notFound('User not found');

    if (input.role !== undefined && input.role !== before.role && (before.role === 'FARMER' || input.role === 'FARMER')) {
      throw badRequest('ROLE_CHANGE_NOT_ALLOWED', 'Farmer accounts cannot be converted to or from staff roles');
    }

    const after = await tx.user.update({ where: { id: targetId }, data: input, select: publicUserSelect });

    const accessChanged = after.role !== before.role || after.status !== before.status;
    let revoked = 0;
    if (after.status === 'DISABLED' || after.role !== before.role) revoked = await revokeUserSessions(tx, targetId);

    await recordAudit(tx, {
      actorId,
      action: accessChanged ? 'user.access_change' : 'user.update',
      entityType: 'User',
      entityId: targetId,
      before: { fullName: before.fullName, role: before.role, status: before.status },
      after: { fullName: after.fullName, role: after.role, status: after.status, revokedSessions: revoked },
      ip,
    });
    return after;
  });
  invalidateAuthCache(targetId);
  return updated;
}
