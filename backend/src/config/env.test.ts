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
