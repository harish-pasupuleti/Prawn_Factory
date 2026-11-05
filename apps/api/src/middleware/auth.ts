import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { forbidden, unauthorized } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../lib/tokens';
import type { AuthUser } from '../types/express';

/**
 * Short-lived in-process cache of the current user, so a burst of requests (a page load fires several)
 * costs one database round trip instead of one each. Role and status changes call invalidateAuthCache(),
 * so they take effect immediately on this instance and within AUTH_CACHE_TTL_MS on any other.
 */
const AUTH_CACHE_TTL_MS = 5_000;
const authCache = new Map<string, { user: AuthUser; expires: number }>();

export const invalidateAuthCache = (userId?: string) => (userId ? authCache.delete(userId) : authCache.clear());

/**
 * Verifies the Bearer access token, then loads the CURRENT user (briefly cached).
 * Role and status always come from the database, never from the token.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw unauthorized();
  const userId = verifyAccessToken(header.slice('Bearer '.length));
  const hit = authCache.get(userId);
  if (hit && hit.expires > Date.now()) {
    req.user = hit.user;
    return next();
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, role: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    authCache.delete(userId);
    throw unauthorized();
  }
  authCache.set(userId, { user, expires: Date.now() + AUTH_CACHE_TTL_MS });
  req.user = user;
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };

/**
 * Cookie-authenticated endpoints (refresh, logout) must carry a custom header.
 * Browsers cannot send it cross-site without a CORS preflight, which our strict CORS policy refuses.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (req.header('x-requested-with') !== 'XMLHttpRequest') {
    return next(forbidden('Missing required request header'));
  }
  next();
};
