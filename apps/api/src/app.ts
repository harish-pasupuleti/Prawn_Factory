import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/error';
import { requestId } from './middleware/requestId';
import { assigneesRouter } from './modules/assignees/routes';
import { authRouter, type AuthRouterOptions } from './modules/auth/routes';
import { collectionsRouter } from './modules/collections/routes';
import { bookingsRouter, exceptionsRouter, queueRouter, shipmentsRouter, slotsRouter, stationsRouter } from './modules/factory/routes';
import { inspectionsRouter } from './modules/inspections/routes';
import { procurementRouter } from './modules/procurement/routes';
import { usersRouter } from './modules/users/routes';
import { vehiclesRouter } from './modules/vehicles/routes';

export function createApp(options: AuthRouterOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as Request).requestId }));
  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const v1 = express.Router();
  v1.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ data: { status: 'ok' } });
  });
  v1.use('/auth', authRouter(options));
  v1.use('/users', usersRouter());
  v1.use('/procurement', procurementRouter());
  v1.use('/inspections', inspectionsRouter());
  v1.use('/collections', collectionsRouter());
  v1.use('/vehicles', vehiclesRouter());
  v1.use('/assignees', assigneesRouter());
  v1.use('/slots', slotsRouter());
  v1.use('/bookings', bookingsRouter());
  v1.use('/shipments', shipmentsRouter());
  v1.use('/exceptions', exceptionsRouter());
  v1.use('/stations', stationsRouter());
  v1.use('/queue', queueRouter());
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
