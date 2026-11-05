import { createApp } from './app';
import { env } from './config/env';
import { databaseWarnings } from './config/dbChecks';
import { logger } from './config/logger';
import { prisma } from './lib/prisma';

for (const warning of databaseWarnings(env.DATABASE_URL, env.DIRECT_URL)) logger.warn(warning);

// Open the first database connection now so the first user request does not pay for it.
void prisma.$connect().catch((err) => logger.warn({ err }, 'Initial database connection failed; will retry on demand'));

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
