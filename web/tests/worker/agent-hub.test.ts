import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStatusInput } from "../../src/shared/schemas";
import { statusBody } from "./helpers";

function hub(name = "unit-test") {
  return env.AGENT_HUB.get(env.AGENT_HUB.idFromName(name));
}

const input = (over: Record<string, unknown> = {}) => statusBody(over) as AgentStatusInput;

afterEach(() => vi.useRealTimers());

describe("desired state", () => {
  it("defaults to stopped", async () => {
    expect((await hub("d1").getDesired()).state).toBe("stopped");
  });

  it("round-trips, and stopping twice logs only one event", async () => {
    const h = hub("d2");
    const started = await h.setDesired("running", 2);
    expect(started.state).toBe("running");
    expect(started.expiresAt).toBeGreaterThan(Date.now() + 2 * 3_600_000 - 5_000);
    expect((await h.getDesired()).state).toBe("running");
    expect((await h.setDesired("stopped")).expiresAt).toBeNull();
    await h.setDesired("stopped"); // no change, no event
    const events = await h.listEvents(10);
    expect(events.map((e) => e.type)).toEqual(["desired_changed", "desired_changed"]);
    expect(events[1]!.message).toBe("Desired state set to running for 2h");
  });

  it("starting again while running restarts the timer", async () => {
    const h = hub("d4");
    const first = await h.setDesired("running", 1);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 1000 });
    const second = await h.setDesired("running", 8);
    expect(second.expiresAt).toBeGreaterThan(first.expiresAt! + 7 * 3_600_000);
    expect((await h.listEvents(1))[0]!.message).toBe("Session restarted for 8h");
  });
});

describe("events", () => {
  it("are capped at 100 and returned newest first", async () => {
    const h = hub("e1");
    for (let i = 0; i < 120; i++) {
      await h.setDesired(i % 2 === 0 ? "running" : "stopped", 1);
    }
    const events = await h.listEvents(100);
    expect(events).toHaveLength(100);
    expect(events[0]!.at).toBeGreaterThanOrEqual(events[99]!.at);
    // the newest event is the 120th change (i = 119 -> "stopped")
    expect(events[0]!.message).toBe("Desired state set to stopped");
    expect(await h.listEvents(500)).toHaveLength(100);
  });
});

describe("sync", () => {
  it("emits agent_online on the first sync and stores a server-side lastSeen", async () => {
    const h = hub("s1");
    const before = Date.now();
    await h.sync(input());
    const { status } = await h.getControl();
    expect(status!.lastSeen).toBeGreaterThanOrEqual(before);
    expect((await h.listEvents(10)).map((e) => e.type)).toEqual(["agent_online"]);
    await h.sync(input()); // already online: no second event
    expect(await h.listEvents(10)).toHaveLength(1);
  });

  it("derives started, url_changed, stopped and agent_error events", async () => {
    const h = hub("s2");
    await h.sync(input());
    await h.sync(input({ running: true, url: "https://a-1.trycloudflare.com", startedAt: 1 }));
    await h.sync(input({ running: true, url: "https://b-2.trycloudflare.com", startedAt: 1 }));
    await h.sync(input({ running: false, lastError: "boom" }));
    await h.sync(input({ running: false, lastError: "boom" })); // same error: no repeat
    const types = (await h.listEvents(20)).map((e) => e.type).reverse();
    expect(types).toEqual([
      "agent_online",
      "tunnel_started",
      "url_changed",
      "tunnel_stopped",
      "agent_error",
    ]);
  });

  it("returns the desired state", async () => {
    const h = hub("s3");
    await h.setDesired("running", 1);
    expect((await h.sync(input())).desired.state).toBe("running");
  });
});

describe("offline alarm", () => {
  it("emits agent_offline_detected once, then agent_online again on the next sync", async () => {
    const h = hub("a1");
    await h.sync(input());
    expect(await runDurableObjectAlarm(h)).toBe(true); // too early: re-arms itself
    expect((await h.listEvents(10)).map((e) => e.type)).toEqual(["agent_online"]);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 200_000 });
    expect(await runDurableObjectAlarm(h)).toBe(true);
    expect((await h.listEvents(10)).map((e) => e.type)).toEqual([
      "agent_offline_detected",
      "agent_online",
    ]);

    await runDurableObjectAlarm(h); // nothing scheduled any more, or no duplicate event
    expect(await h.listEvents(10)).toHaveLength(2);

    await h.sync(input());
    expect((await h.listEvents(10))[0]!.type).toBe("agent_online");
  });
});

describe("hitRateLimit", () => {
  it("allows `limit` hits, blocks the next, and resets after the window", async () => {
    const h = hub("r1");
    for (let i = 0; i < 3; i++) {
      expect((await h.hitRateLimit("k", 3, 60)).allowed).toBe(true);
    }
    const blocked = await h.hitRateLimit("k", 3, 60);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // another key is independent
    expect((await h.hitRateLimit("other", 3, 60)).allowed).toBe(true);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    expect((await h.hitRateLimit("k", 3, 60)).allowed).toBe(true);
  });

  it("resetRateLimit clears the counter", async () => {
    const h = hub("r2");
    await h.hitRateLimit("k", 1, 60);
    expect((await h.hitRateLimit("k", 1, 60)).allowed).toBe(false);
    await h.resetRateLimit("k");
    expect((await h.hitRateLimit("k", 1, 60)).allowed).toBe(true);
  });
});

describe("session expiry", () => {
  it("stops the session when time is up (alarm), logs it, and nudges", async () => {
    const h = hub("x1");
    await h.sync(input());
    await h.setDesired("running", 1);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 3_600_000 + 1000 });
    expect(await runDurableObjectAlarm(h)).toBe(true);
    const desired = await h.getDesired();
    expect(desired).toMatchObject({ state: "stopped", expiresAt: null });
    expect((await h.listEvents(10)).map((e) => e.type)).toContain("session_expired");
  });

  it("is enforced even if the alarm is late: reads and syncs see stopped", async () => {
    const h = hub("x2");
    await h.setDesired("running", 1);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 3_600_000 });
    expect((await h.sync(input())).desired.state).toBe("stopped");
    expect((await h.getControl()).desired).toMatchObject({ state: "stopped", expiresAt: null });
    const expired = (await h.listEvents(20)).filter((e) => e.type === "session_expired");
    expect(expired).toHaveLength(1); // not logged twice
  });

  it("an unexpired session stays running", async () => {
    const h = hub("x3");
    await h.setDesired("running", 4);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 3 * 3_600_000 });
    expect((await h.getDesired()).state).toBe("running");
  });
});
