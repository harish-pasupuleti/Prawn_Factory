import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { unauthorized } from './errors';

const ISSUER = 'prawn-factory';
const AUDIENCE = 'prawn-factory-api';

export function signAccessToken(userId: string): string {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SEC,
  });
}

/** Returns the user id from a valid access token or throws 401. */
export function verifyAccessToken(token: string): string {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'object' && typeof payload.sub === 'string') return payload.sub;
  } catch {
    // fall through
  }
  throw unauthorized();
}

/** Opaque, high-entropy refresh token. Only its SHA-256 hash is stored in the database. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
