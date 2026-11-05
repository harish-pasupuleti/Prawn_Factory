import { PrismaClient, type Prisma } from '@prisma/client';
import { env } from '../config/env';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/** The transaction client passed to prisma.$transaction(async (tx) => ...). */
export type Tx = Prisma.TransactionClient;
