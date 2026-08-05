import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  CORS_ORIGIN: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  FRONTEND_URL: z.string().url(),
  LOCK_TTL_SECONDS: z.coerce.number().default(300),
  /** When true, ticket email is sent by outbox worker; HTTP path skips fire-and-forget. */
  EMAIL_VIA_OUTBOX: z
    .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
    .default(false),
  OUTBOX_POLL_MS: z.coerce.number().default(2000),
  OUTBOX_BATCH_SIZE: z.coerce.number().default(10),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().default(10),
  /** Wait for contact_email / send_ticket_email post-RPC update (WKR-005.1 race). */
  OUTBOX_SETTLE_MS: z.coerce.number().default(5000),
  OUTBOX_RETRY_BASE_MS: z.coerce.number().default(2000),
  /** Structured heartbeat log interval (WKR-006.1). */
  OUTBOX_HEARTBEAT_MS: z.coerce.number().default(30_000),
  /** Requeue processing rows older than this (WKR-006.1 stuck reaper). */
  OUTBOX_STALE_PROCESSING_MS: z.coerce.number().default(300_000),
  OUTBOX_STALE_RECOVERY_LIMIT: z.coerce.number().default(50),
  /**
   * How often to call recover_stuck_outbox_events (separate from OUTBOX_POLL_MS).
   * Default 60s so recovery is not on every poll tick.
   */
  OUTBOX_RECOVERY_INTERVAL_MS: z.coerce.number().default(60_000),
  /** WKR-006.2 — Sentry error monitoring (off by default). */
  SENTRY_ENABLED: z
    .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
    .default(false),
  SENTRY_DSN: z.string().default(""),
  SENTRY_ENVIRONMENT: z.string().default(""),
  SENTRY_RELEASE: z.string().default(""),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Environment validation failed:", result.error.flatten());
    throw new Error("Invalid environment variables");
  }
  return result.data;
}

export const env = loadEnv();
