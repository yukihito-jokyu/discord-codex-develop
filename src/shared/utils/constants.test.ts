import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTL_MS,
  DISCORD_MAX_LENGTH,
  PLAN_OUTPUT_MAX_BYTES,
  RATE_LIMIT_TTL_MS,
  THREAD_COMPLETED_TTL_S,
  THREAD_SESSION_TTL_S,
} from "@/shared/utils/constants";

describe("constants", () => {
  it("DISCORD_MAX_LENGTH is 2000", () => {
    expect(DISCORD_MAX_LENGTH).toBe(2000);
  });

  it("DEFAULT_TTL_MS is 86400000 (24h)", () => {
    expect(DEFAULT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("RATE_LIMIT_TTL_MS is 3600000 (1h)", () => {
    expect(RATE_LIMIT_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("THREAD_SESSION_TTL_S is 86400 (24h)", () => {
    expect(THREAD_SESSION_TTL_S).toBe(86400);
  });

  it("THREAD_COMPLETED_TTL_S is 3600 (1h)", () => {
    expect(THREAD_COMPLETED_TTL_S).toBe(3600);
  });

  it("PLAN_OUTPUT_MAX_BYTES is 10240 (10KB)", () => {
    expect(PLAN_OUTPUT_MAX_BYTES).toBe(10240);
  });
});
