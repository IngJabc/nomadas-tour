import { z } from "zod";
import {
  normalizeEmailDeliveryMode,
  parseAllowedRecipients,
} from "../services/email-delivery-policy.js";

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
  /**
   * OPS-EMAIL-001 — Temporary Resend delivery gate.
   * normal | restricted | disabled (default normal).
   */
  EMAIL_DELIVERY_MODE: z
    .string()
    .optional()
    .transform((v) => normalizeEmailDeliveryMode(v)),
  /**
   * CSV allowlist used only when EMAIL_DELIVERY_MODE=restricted.
   * Empty list = fail-safe (skip all sends).
   */
  EMAIL_ALLOWED_RECIPIENTS: z
    .string()
    .optional()
    .transform((v) => parseAllowedRecipients(v ?? "")),
  LOCK_TTL_SECONDS: z.coerce.number().default(300),
  /** When true, ticket email is sent by outbox worker; HTTP path skips fire-and-forget. */
  EMAIL_VIA_OUTBOX: z
    .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
    .default(false),
  /** When true, trip lifecycle effects will use outbox wiring; false keeps legacy behavior. */
  TRIP_EFFECTS_VIA_OUTBOX: z
    .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
    .default(false),
  /**
   * WKR-008 — When true, reminder scheduler emits trip.reminder_due and
   * handlers deliver booker/agency emails + in-app notifications.
   * Default false until soak/audit.
   */
  TRIP_REMINDER_VIA_OUTBOX: z
    .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
    .default(false),
  /** WKR-008 — reminder scheduler poll interval (default 1h). */
  REMINDER_SCHEDULE_POLL_MS: z.coerce.number().default(3_600_000),
  /** WKR-008 — max trips scanned per schedule_trip_reminders call. */
  REMINDER_SCHEDULE_BATCH: z.coerce.number().default(50),
  /**
   * WKR-009 — When true, retention scheduler purges old completed outbox rows.
   * Default false until soak/audit.
   */
  OUTBOX_RETENTION_VIA_WORKER: z
    .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
    .default(false),
  /** WKR-009 — retention scheduler poll interval (default 24h). */
  OUTBOX_RETENTION_POLL_MS: z.coerce.number().default(86_400_000),
  /** WKR-009 — max rows deleted per purge_completed_outbox_events call. */
  OUTBOX_RETENTION_BATCH: z.coerce.number().default(1000),
  /**
   * WKR-009 — retention age in days (RPC clamps to >= 30).
   * Zod does not enforce the floor; the RPC is the security authority.
   */
  OUTBOX_RETENTION_DAYS: z.coerce.number().default(30),
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
  SENTRY_ENVIRONMENT: z
  .string()
  .default("production"),
  SENTRY_RELEASE: z.string().default(""),
  /**
   * WKR-006.4 — HTTP health port for worker process (Render Free Web Service).
   * On Render, set this to the platform PORT value.
   */
  WORKER_HEALTH_PORT: z.coerce.number().default(3002),
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
