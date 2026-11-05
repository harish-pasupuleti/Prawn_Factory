import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { conflict, forbidden } from '../../src/lib/errors';
import { errorHandler, notFoundHandler } from '../../src/middleware/error';
import { requestId } from '../../src/middleware/requestId';

function makeApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.get('/app-error', () => { throw conflict('SOME_CONFLICT', 'Nope', { a: 1 }); });
  app.get('/forbidden', () => { throw forbidden(); });
  app.post('/zod', (req) => { z.object({ n: z.number() }).strict().parse(req.body); });
  app.get('/boom', () => { throw new Error('database password is hunter2'); });
  app.get('/prisma', () => { throw Object.assign(new Error('Invalid invocation ... passwordHash: "abc"'), { name: 'PrismaClientKnownRequestError', code: 'P2002' }); });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('centralised error handling', () => {
  const app = makeApp();

  it('formats AppError with code, message, details and requestId', async () => {
    const res = await request(app).get('/app-error');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SOME_CONFLICT', message: 'Nope', details: { a: 1 } });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 403 for forbidden', async () => {
    expect((await request(app).get('/forbidden')).status).toBe(403);
  });

  it('turns Zod failures into 400 VALIDATION_ERROR with per-field details', async () => {
    const res = await request(app).post('/zod').send({ n: 'x', extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('returns 400 INVALID_JSON for malformed bodies', async () => {
    const res = await request(app).post('/zod').set('Content-Type', 'application/json').send('{"n":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('hides internal details of unexpected errors', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('maps unique violations to 409 without leaking the message', async () => {
    const res = await request(app).get('/prisma');
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('returns 404 in the standard error format for unknown routes', async () => {
    const res = await request(app).get('/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
