import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { prisma } from '../../src/lib/prisma';
import { app, bearer, createUser, loginAs, PASSWORD, refreshCookieFrom } from './helpers';

const registration = () => ({
  email: `farmer-${randomUUID()}@test.local`,
  password: PASSWORD,
  fullName: 'Ravi Kumar',
  phone: '9876543210',
  village: 'Razole',
  district: 'Konaseema',
  state: 'Andhra Pradesh',
});

describe('registration', () => {
  it('creates a FARMER with a profile and never returns secrets', async () => {
    const body = registration();
    const res = await request(app).post('/api/v1/auth/register').send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('FARMER');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password/i);
    const stored = await prisma.user.findUnique({ where: { email: body.email }, include: { farmerProfile: true } });
    expect(stored?.farmerProfile?.village).toBe('Razole');
    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects role injection and creates nothing', async () => {
    const body = { ...registration(), role: 'ADMIN' };
    const res = await request(app).post('/api/v1/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.user.findUnique({ where: { email: body.email } })).toBeNull();
  });

  it('rejects a duplicate email with 409', async () => {
    const body = registration();
    expect((await request(app).post('/api/v1/auth/register').send(body)).status).toBe(201);
    const again = await request(app).post('/api/v1/auth/register').send(body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('writes an audit event without the password', async () => {
    const body = registration();
    const res = await request(app).post('/api/v1/auth/register').send(body);
    const events = await prisma.auditEvent.findMany({ where: { entityId: res.body.data.user.id, action: 'auth.register' } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toMatch(/password/i);
  });
});

describe('login', () => {
  it('returns an access token and an HttpOnly SameSite=Strict refresh cookie scoped to /api/v1/auth', async () => {
    const user = await createUser('FARMER');
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('refreshToken');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('pf_refresh='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/i);
  });

  it('gives identical responses for a wrong password and an unknown email', async () => {
    const user = await createUser('FARMER');
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'definitely-wrong-1' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: `nobody-${randomUUID()}@test.local`, password: 'definitely-wrong-1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after 5 failures, even for the correct password', async () => {
    const user = await createUser('FARMER');
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password-1' });
      expect(res.status).toBe(401);
    }
    const locked = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(locked.status).toBe(401);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.lockedUntil).not.toBeNull();
  });

  it('refuses disabled accounts with the generic error', async () => {
    const user = await createUser('FARMER', { status: 'DISABLED' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('is rate limited', async () => {
    const limited = createApp({ loginMax: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await request(limited).post('/api/v1/auth/login').send({ email: 'x@test.local', password: 'wrong-password-1' })).status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
  });
});

describe('access tokens and /me', () => {
  it('requires a valid token', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(bearer('garbage'))).status).toBe(401);
    const forged = jwt.sign({}, 'x'.repeat(40), { subject: randomUUID(), issuer: 'prawn-factory', audience: 'prawn-factory-api' });
    expect((await request(app).get('/api/v1/auth/me').set(bearer(forged))).status).toBe(401);
  });

  it('returns the current user and farmer profile', async () => {
    const user = await createUser('FARMER');
    const res = await request(app).get('/api/v1/auth/me').set(bearer(await loginAs(user)));
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user.farmerProfile.village).toBe('Razole');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('stops working immediately when the user is disabled', async () => {
    const user = await createUser('FARMER');
    const token = await loginAs(user);
    expect((await request(app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(200);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    expect((await request(app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
  });

  it('uses the role stored in the database, not a role claim', async () => {
    const farmer = await createUser('FARMER');
    const forged = jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, {
      subject: farmer.id, issuer: 'prawn-factory', audience: 'prawn-factory-api', expiresIn: 60,
    });
    const res = await request(app).get('/api/v1/users').set(bearer(forged));
    expect(res.status).toBe(403);
  });
});

describe('refresh-token rotation', () => {
  it('requires the CSRF header', async () => {
    const user = await createUser('FARMER');
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookieFrom(login));
    expect(res.status).toBe(403);
  });

  it('rotates the token and detects reuse of an old token', async () => {
    const user = await createUser('FARMER');
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    const first = refreshCookieFrom(login);

    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', first).set('X-Requested-With', 'XMLHttpRequest');
    expect(rotated.status).toBe(200);
    expect(typeof rotated.body.data.accessToken).toBe('string');
    const second = refreshCookieFrom(rotated);
    expect(second).not.toBe(first);

    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', first).set('X-Requested-With', 'XMLHttpRequest');
    expect(replay.status).toBe(401);

    // Reuse revokes the whole family: the legitimately rotated token stops working too.
    const afterReuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', second).set('X-Requested-With', 'XMLHttpRequest');
    expect(afterReuse.status).toBe(401);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: user.id, action: 'auth.refresh_reuse_detected' } });
    expect(audit).not.toBeNull();
  });

  it('stores only hashes of refresh tokens', async () => {
    const user = await createUser('FARMER');
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    const raw = refreshCookieFrom(login).split('=')[1]!;
    const sessions = await prisma.refreshSession.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(raw);
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('logout revokes the session', async () => {
    const user = await createUser('FARMER');
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    const cookie = refreshCookieFrom(login);
    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(out.status).toBe(204);
    const after = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest');
    expect(after.status).toBe(401);
  });

  it('refuses a missing or unknown cookie', async () => {
    expect((await request(app).post('/api/v1/auth/refresh').set('X-Requested-With', 'XMLHttpRequest')).status).toBe(401);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set('Cookie', 'pf_refresh=nope').set('X-Requested-With', 'XMLHttpRequest')).status,
    ).toBe(401);
  });
});
