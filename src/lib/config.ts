import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  SUPPLIER_BASE_URL: z.url().default('http://api:3000'),
  SUPPLIER_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

  TEMPORAL_ADDRESS: z.string().min(1).default('temporal:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('hotel-offers'),
  WORKFLOW_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  REDIS_URL: z.string().min(1).default('redis://redis:6379'),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  PARTIAL_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),

  SUPPLIER_A_DOWN: z.stringbool().default(false),
  SUPPLIER_B_DOWN: z.stringbool().default(false),
});

export type Config = z.infer<typeof envSchema>;

const parseConfig = (): Config => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Fail fast at startup with a readable message; the logger depends on config, so use stderr.
    console.error('Invalid environment configuration:\n' + z.prettifyError(result.error));
    process.exit(1);
  }
  return result.data;
};

export const config: Config = parseConfig();
