import { z } from "zod";

const envSchema = z.object({
  LEONEL_PLATFORM_ENV: z.string().default("local"),
  LEONEL_PLATFORM_LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
  /** Prefer Render's PORT; fall back to API_PORT for local/docker. */
  API_PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(7),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const withPort = {
    ...env,
    API_PORT: env.PORT ?? env.API_PORT,
  };
  const parsed = envSchema.safeParse(withPort);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
