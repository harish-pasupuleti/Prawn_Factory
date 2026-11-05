import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { app, bearer, createUser, loginAs, PASSWORD, type TestUser } from './helpers';

let admin: TestUser;
let adminToken: string;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  adminToken = await loginAs(admin);
});

const staffBody = (role: string) => ({
  email: `${role.toLowerCase()}-${randomUUID()}@test.local`,
  password: PASSWORD,
  fullName: 'Staff Member',
  role,
});

describe('user administration', () => {
  it('only administrators can access user endpoints', async () => {
    for (const role of ['FARMER', 'PURCHASE_MANAGER', 'FIELD_OFFICER', 'TRANSPORT_OFFICER', 'SECURITY_OFFICER', 'FACTORY_OPERATOR'] as const) {
      const token = await loginAs(await createUser(role));
      expect((await request(app).get('/api/v1/users').set(bearer(token))).status).toBe(403);
      expect((await request(app).post('/api/v1/users').set(bearer(token)).send(staffBody('ADMIN'))).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/users')).status).toBe(401);
  });

  it('creates every staff role, hashes the password and audits the action', async () => {
    for (const role of ['PURCHASE_MANAGER', 'FIELD_OFFICER', 'TRANSPORT_OFFICER', 'SECURITY_OFFICER', 'FACTORY_OPERATOR', 'ADMIN']) {
      const res = await request(app).post('/api/v1/users').set(bearer(adminToken)).send(staffBody(role));
      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe(role);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
      const audit = await prisma.auditEvent.findFirst({ where: { entityId: res.body.data.id, action: 'user.create' } });
      expect(audit?.actorId).toBe(admin.id);
    }
  });

  it('does not create farmer accounts or accept extra fields', async () => {
    expect((await request(app).post('/api/v1/users').set(bearer(adminToken)).send(staffBody('FARMER'))).status).toBe(400);
    expect(
      (await request(app).post('/api/v1/users').set(bearer(adminToken)).send({ ...staffBody('FIELD_OFFICER'), status: 'DISABLED' })).status,
    ).toBe(400);
  });

  it('lists with pagination and filters', async () => {
    const res = await request(app).get('/api/v1/users?role=FARMER&pageSize=2').set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.meta.pageSize).toBe(2);
    expect(res.body.data.every((u: { role: string }) => u.role === 'FARMER')).toBe(true);
  });

  it('disabling a user revokes sessions, blocks access and is audited with before/after', async () => {
    const target = await createUser('FIELD_OFFICER');
    const login = await request(app).post('/api/v1/auth/login').send({ email: target.email, password: target.password });
    const res = await request(app).patch(`/api/v1/users/${target.id}`).set(bearer(adminToken)).send({ status: 'DISABLED' });
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(bearer(login.body.data.accessToken))).status).toBe(401);
    expect(await prisma.refreshSession.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: target.id, action: 'user.access_change' } });
    expect(audit?.before).toMatchObject({ status: 'ACTIVE' });
    expect(audit?.after).toMatchObject({ status: 'DISABLED' });
  });

  it('prevents administrators from changing their own role or status', async () => {
    const res = await request(app).patch(`/api/v1/users/${admin.id}`).set(bearer(adminToken)).send({ status: 'DISABLED' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('blocks converting farmers to or from staff roles', async () => {
    const farmer = await createUser('FARMER');
    const res = await request(app).patch(`/api/v1/users/${farmer.id}`).set(bearer(adminToken)).send({ role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ROLE_CHANGE_NOT_ALLOWED');
  });

  it('returns 404 for unknown users and 400 for malformed ids', async () => {
    expect((await request(app).patch(`/api/v1/users/${randomUUID()}`).set(bearer(adminToken)).send({ fullName: 'Nobody Here' })).status).toBe(404);
    expect((await request(app).patch('/api/v1/users/not-a-uuid').set(bearer(adminToken)).send({ fullName: 'Nobody Here' })).status).toBe(400);
  });
});
