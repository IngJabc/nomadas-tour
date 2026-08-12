/// <reference types="node" />

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import process from "node:process";

const originalEnv = { ...process.env };

const requiredEnv = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  JWT_SECRET: "test-jwt-secret",
  NODE_ENV: "test",
  CORS_ORIGIN: "http://localhost:3000",
  RESEND_API_KEY: "test-resend",
  EMAIL_FROM: "test@example.com",
  FRONTEND_URL: "http://localhost:3000",
};

async function parseTripEffectsViaOutbox(value?: string) {
  process.env = { ...originalEnv, ...requiredEnv };
  if (value === undefined) {
    delete process.env.TRIP_EFFECTS_VIA_OUTBOX;
  } else {
    process.env.TRIP_EFFECTS_VIA_OUTBOX = value;
  }

  const { env } = await import("./env.js");
  return env.TRIP_EFFECTS_VIA_OUTBOX;
}

async function parseTripReminderViaOutbox(value?: string) {
  process.env = { ...originalEnv, ...requiredEnv };
  if (value === undefined) {
    delete process.env.TRIP_REMINDER_VIA_OUTBOX;
  } else {
    process.env.TRIP_REMINDER_VIA_OUTBOX = value;
  }

  const { env } = await import("./env.js");
  return env.TRIP_REMINDER_VIA_OUTBOX;
}

describe("C1 — TRIP_EFFECTS_VIA_OUTBOX environment flag", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.each([
    ["an absent value", undefined, false],
    ['"false"', "false", false],
    ['"true"', "true", true],
    ['"1"', "1", true],
  ])("parses %s as %s", async (_label, value, expected) => {
    await expect(parseTripEffectsViaOutbox(value)).resolves.toBe(expected);
  });
});

describe("WKR-008 — TRIP_REMINDER_VIA_OUTBOX environment flag", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.each([
    ["an absent value", undefined, false],
    ['"false"', "false", false],
    ['"true"', "true", true],
    ['"1"', "1", true],
  ])("parses %s as %s", async (_label, value, expected) => {
    await expect(parseTripReminderViaOutbox(value)).resolves.toBe(expected);
  });

  it("defaults REMINDER_SCHEDULE_POLL_MS to 1h and BATCH to 50", async () => {
    process.env = { ...originalEnv, ...requiredEnv };
    delete process.env.REMINDER_SCHEDULE_POLL_MS;
    delete process.env.REMINDER_SCHEDULE_BATCH;
    delete process.env.TRIP_REMINDER_VIA_OUTBOX;
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.REMINDER_SCHEDULE_POLL_MS).toBe(3_600_000);
    expect(env.REMINDER_SCHEDULE_BATCH).toBe(50);
    expect(env.TRIP_REMINDER_VIA_OUTBOX).toBe(false);
  });
});

async function parseOutboxRetentionViaWorker(value?: string) {
  process.env = { ...originalEnv, ...requiredEnv };
  if (value === undefined) {
    delete process.env.OUTBOX_RETENTION_VIA_WORKER;
  } else {
    process.env.OUTBOX_RETENTION_VIA_WORKER = value;
  }

  const { env } = await import("./env.js");
  return env.OUTBOX_RETENTION_VIA_WORKER;
}

describe("WKR-009 — OUTBOX_RETENTION_* environment", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.each([
    ["an absent value", undefined, false],
    ['"false"', "false", false],
    ['"true"', "true", true],
    ['"1"', "1", true],
  ])("parses OUTBOX_RETENTION_VIA_WORKER %s as %s", async (_label, value, expected) => {
    await expect(parseOutboxRetentionViaWorker(value)).resolves.toBe(expected);
  });

  it("defaults poll 24h, batch 1000, days 30, flag false", async () => {
    process.env = { ...originalEnv, ...requiredEnv };
    delete process.env.OUTBOX_RETENTION_VIA_WORKER;
    delete process.env.OUTBOX_RETENTION_POLL_MS;
    delete process.env.OUTBOX_RETENTION_BATCH;
    delete process.env.OUTBOX_RETENTION_DAYS;
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.OUTBOX_RETENTION_VIA_WORKER).toBe(false);
    expect(env.OUTBOX_RETENTION_POLL_MS).toBe(86_400_000);
    expect(env.OUTBOX_RETENTION_BATCH).toBe(1000);
    expect(env.OUTBOX_RETENTION_DAYS).toBe(30);
  });
});

async function parseAgencyDigestViaWorker(value?: string) {
  process.env = { ...originalEnv, ...requiredEnv };
  if (value === undefined) {
    delete process.env.AGENCY_DIGEST_VIA_WORKER;
  } else {
    process.env.AGENCY_DIGEST_VIA_WORKER = value;
  }

  const { env } = await import("./env.js");
  return env.AGENCY_DIGEST_VIA_WORKER;
}

describe("F4-001 — AGENCY_DIGEST_* environment", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.each([
    ["an absent value", undefined, false],
    ['"false"', "false", false],
    ['"true"', "true", true],
    ['"1"', "1", true],
  ])("parses AGENCY_DIGEST_VIA_WORKER %s as %s", async (_label, value, expected) => {
    await expect(parseAgencyDigestViaWorker(value)).resolves.toBe(expected);
  });

  it("defaults poll 1h, batch 50, flag false", async () => {
    process.env = { ...originalEnv, ...requiredEnv };
    delete process.env.AGENCY_DIGEST_VIA_WORKER;
    delete process.env.AGENCY_DIGEST_POLL_MS;
    delete process.env.AGENCY_DIGEST_BATCH;
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.AGENCY_DIGEST_VIA_WORKER).toBe(false);
    expect(env.AGENCY_DIGEST_POLL_MS).toBe(3_600_000);
    expect(env.AGENCY_DIGEST_BATCH).toBe(50);
  });
});
