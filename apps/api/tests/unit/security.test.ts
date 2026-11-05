import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { scrub } from '../../src/lib/audit';
import { hashPassword, verifyPassword } from '../../src/lib/password';
import { generateRefreshToken, hashToken, signAccessToken, verifyAccessToken } from '../../src/lib/tokens';

describe('password hashing', () => {
  it('uses Argon2id with unique salts and verifies correctly', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a.startsWith('$argon2id$')).toBe(true);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(a, 'wrong password')).toBe(false);
  });
  it('returns false (does not throw) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('access tokens', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  it('round-trips the subject', () => {
    expect(verifyAccessToken(signAccessToken(userId))).toBe(userId);
  });
  it('rejects tampered, wrong-secret, wrong-audience, expired and unsigned tokens', () => {
    const token = signAccessToken(userId);
    expect(() => verifyAccessToken(token.slice(0, -2) + 'xx')).toThrow();
    expect(() => verifyAccessToken(jwt.sign({}, 'x'.repeat(40), { subject: userId, issuer: 'prawn-factory', audience: 'prawn-factory-api' }))).toThrow();
    expect(() => verifyAccessToken(jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, issuer: 'prawn-factory', audience: 'other' }))).toThrow();
    expect(() => verifyAccessToken(jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, issuer: 'prawn-factory', audience: 'prawn-factory-api', expiresIn: -10 }))).toThrow();
    expect(() => verifyAccessToken(jwt.sign({ sub: userId }, '', { algorithm: 'none' }))).toThrow();
  });
});

describe('refresh tokens', () => {
  it('are high-entropy, unique and stored only as a SHA-256 hash', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(64);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });
});

describe('audit scrubbing', () => {
  it('removes sensitive keys at any depth and serialises Decimals/Dates', () => {
    const out = scrub({
      email: 'a@b.co',
      passwordHash: 'secret',
      nested: { refreshToken: 't', accessToken: 't2', ok: 1, list: [{ password: 'p', keep: true }] },
      when: new Date('2030-01-01T00:00:00Z'),
      amount: { toJSON: () => '12.500' },
    });
    expect(out).toEqual({
      email: 'a@b.co',
      nested: { ok: 1, list: [{ keep: true }] },
      when: '2030-01-01T00:00:00.000Z',
      amount: '12.500',
    });
  });
  it('returns undefined for undefined', () => {
    expect(scrub(undefined)).toBeUndefined();
  });
});
