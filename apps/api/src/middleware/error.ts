import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';
import { AppError, notFound } from '../lib/errors';

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Route not found'));

interface ErrorLike {
  name?: string;
  code?: string;
  type?: string;
  message?: string;
  stack?: string;
}

/** Never log Prisma error messages: they can embed query arguments (including hashes). */
function loggable(err: unknown) {
  const e = (err ?? {}) as ErrorLike;
  if (typeof e.name === 'string' && e.name.startsWith('PrismaClient')) return { name: e.name, code: e.code };
  return { name: e.name, message: e.message, stack: e.stack };
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  const e = (err ?? {}) as ErrorLike;
  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  } else if (e.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if (e.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if (e.code === 'P2002') {
    status = 409;
    code = 'CONFLICT';
    message = 'A record with these values already exists';
  }

  if (status >= 500) logger.error({ requestId: req.requestId, err: loggable(err) }, 'Unhandled error');
  if (res.headersSent) return next(err);

  res.status(status).json({ error: { code, message, details, requestId: req.requestId } });
};
