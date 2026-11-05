import type { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { recordAudit } from '../../lib/audit';
import { AppError, isUniqueViolation, unauthorized } from '../../lib/errors';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../lib/password';
import { prisma, type Tx } from '../../lib/prisma';
import { generateRefreshToken, hashToken, signAccessToken } from '../../lib/tokens';
import type { LoginInput, RegisterInput } from './schemas';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  status: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export interface SessionResult {
  user: Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

async function issueRefreshToken(db: Tx, userId: string): Promise<string> {
  const token = generateRefreshToken();
  await db.refreshSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

/** Revokes every active refresh session for a user. Call inside the transaction that needs it. */
export async function revokeUserSessions(tx: Tx, userId: string): Promise<number> {
  const result = await tx.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function registerFarmer(input: RegisterInput, ip: string | undefined) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: 'FARMER',
          farmerProfile: {
            create: { phone: input.phone, village: input.village, district: input.district, state: input.state },
          },
        },
        select: publicUserSelect,
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: 'auth.register',
        entityType: 'User',
        entityId: user.id,
        after: { email: user.email, role: user.role },
        ip,
      });
      return user;
    });
  } catch (err) {
    // Known limitation (documented): without email verification, registration reveals that an email is taken.
    if (isUniqueViolation(err)) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    throw err;
  }
}

export async function login(input: LoginInput, ip: string | undefined): Promise<SessionResult> {
  const account = await prisma.user.findUnique({ where: { email: input.email } });

  if (!account) {
    await verifyAgainstDummy(input.password);
    throw unauthorized('Invalid email or password');
  }

  const locked = account.lockedUntil !== null && account.lockedUntil > new Date();
  const passwordOk = await verifyPassword(account.passwordHash, input.password);

  // Locked, disabled and wrong-password cases all return the same generic response.
  if (locked || account.status !== 'ACTIVE' || !passwordOk) {
    if (!locked && account.status === 'ACTIVE' && !passwordOk) {
      const updated = await prisma.user.update({
        where: { id: account.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      const lockNow = updated.failedLoginCount >= MAX_FAILED_LOGINS;
      if (lockNow) {
        await prisma.user.update({
          where: { id: account.id },
          data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) },
        });
      }
      await prisma.$transaction((tx) =>
        recordAudit(tx, {
          actorId: null,
          action: lockNow ? 'auth.account_locked' : 'auth.login_failed',
          entityType: 'User',
          entityId: account.id,
          ip,
        }),
      );
    }
    throw unauthorized('Invalid email or password');
  }

  const refreshToken = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: account.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    const refreshToken = await issueRefreshToken(tx, account.id);
    await recordAudit(tx, {
      actorId: account.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: account.id,
      ip,
    });
    return refreshToken;
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: account.id }, select: publicUserSelect });
  return { user, accessToken: signAccessToken(user.id), expiresIn: env.ACCESS_TOKEN_TTL_SEC, refreshToken };
}

/**
 * Single-use refresh-token rotation. Presenting an already-used token is treated as theft:
 * every session of that user is revoked.
 */
export async function refreshSession(rawToken: string, ip: string | undefined): Promise<SessionResult> {
  const session = await prisma.refreshSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: publicUserSelect } },
  });
  if (!session) throw unauthorized();

  const reuseDetected = async () => {
    await prisma.$transaction(async (tx) => {
      await revokeUserSessions(tx, session.userId);
      await recordAudit(tx, {
        actorId: null,
        action: 'auth.refresh_reuse_detected',
        entityType: 'User',
        entityId: session.userId,
        ip,
      });
    });
    throw unauthorized();
  };

  if (session.revokedAt) return reuseDetected();
  if (session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') throw unauthorized();

  const nextToken = await prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) return null; // lost a race with another use of the same token
    return issueRefreshToken(tx, session.userId);
  });
  if (!nextToken) return reuseDetected();

  return {
    user: session.user,
    accessToken: signAccessToken(session.userId),
    expiresIn: env.ACCESS_TOKEN_TTL_SEC,
    refreshToken: nextToken,
  };
}

export async function logout(rawToken: string | undefined, ip: string | undefined): Promise<void> {
  if (!rawToken) return;
  const session = await prisma.refreshSession.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!session || session.revokedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { actorId: session.userId, action: 'auth.logout', entityType: 'User', entityId: session.userId, ip });
  });
}

export async function getCurrentUser(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...publicUserSelect, farmerProfile: { select: { phone: true, village: true, district: true, state: true } } },
  });
}
