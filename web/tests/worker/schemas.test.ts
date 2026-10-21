import { describe, expect, it } from "vitest";
import {
  AgentStatusInputSchema,
  EventsQuerySchema,
  SetDesiredBodySchema,
  TUNNEL_URL_RE,
} from "../../src/shared/schemas";
import { statusBody } from "./helpers";

describe("AgentStatusInputSchema", () => {
  it("accepts a valid body and strips lastSeen", () => {
    const parsed = AgentStatusInputSchema.parse({ ...statusBody(), lastSeen: 1 });
    expect(parsed).not.toHaveProperty("lastSeen");
  });

  it("accepts a trycloudflare URL and null", () => {
    expect(
      AgentStatusInputSchema.safeParse(statusBody({ url: "https://abc-123.trycloudflare.com" }))
        .success,
    ).toBe(true);
    expect(AgentStatusInputSchema.safeParse(statusBody({ url: null })).success).toBe(true);
  });

  it.each([
    "http://abc.trycloudflare.com",
    "https://evil.com",
    "https://abc.trycloudflare.com.evil.com",
    "https://abc.trycloudflare.com/path",
    "https://ABC.trycloudflare.com",
    "javascript:alert(1)",
  ])("rejects URL %s", (url) => {
    expect(AgentStatusInputSchema.safeParse(statusBody({ url })).success).toBe(false);
    expect(TUNNEL_URL_RE.test(url)).toBe(false);
  });

  it("rejects wrong types and over-long strings", () => {
    expect(AgentStatusInputSchema.safeParse(statusBody({ running: "yes" })).success).toBe(false);
    expect(
      AgentStatusInputSchema.safeParse(statusBody({ hostname: "x".repeat(256) })).success,
    ).toBe(false);
    expect(
      AgentStatusInputSchema.safeParse(statusBody({ lastError: "x".repeat(2001) })).success,
    ).toBe(false);
    expect(AgentStatusInputSchema.safeParse(statusBody({ startedAt: -1 })).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("SetDesiredBodySchema only allows running/stopped", () => {
    expect(SetDesiredBodySchema.safeParse({ state: "running", durationHours: 2 }).success).toBe(
      true,
    );
    expect(SetDesiredBodySchema.safeParse({ state: "stopped" }).success).toBe(true);
    expect(SetDesiredBodySchema.safeParse({ state: "running" }).success).toBe(false);
    expect(SetDesiredBodySchema.safeParse({ state: "paused" }).success).toBe(false);
  });

  it("EventsQuerySchema defaults and bounds the limit", () => {
    expect(EventsQuerySchema.parse({}).limit).toBe(50);
    expect(EventsQuerySchema.parse({ limit: "20" }).limit).toBe(20);
    expect(EventsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(EventsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});
