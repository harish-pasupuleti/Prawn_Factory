import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma skips automatic .env loading when a prisma.config.ts exists,
// so load it explicitly. Variables already set (e.g. by dotenv-cli) win.
dotenv.config({ quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
