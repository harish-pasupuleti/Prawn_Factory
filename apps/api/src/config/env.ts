import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env.<NODE_ENV> first (e.g. .env.test), then .env. Existing process variables always win.
const nodeEnv = process.env.NODE_ENV ?? 'development';
dotenv.config({ path: `.env.${nodeEnv}`, quiet: true });
dotenv.config({ quiet: true });

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: booleanString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FACTORY_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
  // Allowed difference (percent) between declared/inspected/collected quantities before a written explanation is required.
  QUANTITY_VARIANCE_THRESHOLD_PCT: z.coerce.number().min(0).max(100).default(10),
  // Percent difference between the received (net) weight and the collected quantity above which an exception is raised.
  RECEPTION_VARIANCE_THRESHOLD_PCT: z.coerce.number().min(0).max(100).default(5),
  // Target processing time = received tonnes x this value, never less than PROCESSING_MIN_MINUTES.
  PROCESSING_MINUTES_PER_TONNE: z.coerce.number().int().min(1).max(10_000).default(120),
  PROCESSING_MIN_MINUTES: z.coerce.number().int().min(1).max(10_000).default(30),
  // A vehicle may be admitted without an override from this long before the slot starts until this long after it ends.
  GATE_EARLY_GRACE_MIN: z.coerce.number().int().min(0).max(1_440).default(60),
  GATE_LATE_GRACE_MIN: z.coerce.number().int().min(0).max(1_440).default(30),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Only variable names and messages are printed - never values.
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    const message = `Invalid environment configuration:\n${lines.join('\n')}\nSee apps/api/.env.example.`;
    if (process.env.NODE_ENV === 'test') throw new Error(message);
    console.error(message);
    process.exit(1);
  }
  const parsed = result.data;
  if (parsed.NODE_ENV === 'production' && /replace|change-?me|example|placeholder/i.test(parsed.JWT_ACCESS_SECRET)) {
    console.error('JWT_ACCESS_SECRET still looks like a placeholder. Generate a random value.');
    process.exit(1);
  }
  return parsed;
}

export const env = loadEnv();
