import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentHeaders,
  call,
  getControl,
  getEvents,
  login,
  putBody,
  putDesired,
  statusBody,
  sync,
} from "./helpers";

beforeEach(async () => {
  await reset();
});
afterEach(() => vi.useRealTimers());

describe("GET /api/health", () => {
  it("needs no auth and leaks nothing", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /api/agent/sync", () => {
  it("401 without a token or with a wrong token", async () => {
    const none = await call("/api/agent/sync", { method: "POST", body: "{}" });
    expect(none.status).toBe(401);
    expect(await none.json()).toMatchObject({ error: { code: "unauthorized" } });
    const wrong = await call("/api/agent/sync", {
      method: "POST",
      headers: { Authorization: "Bearer nope" },
      body: JSON.stringify(statusBody()),
    });
    expect(wrong.status).toBe(401);
  });

  it("400 on an invalid body, bad JSON, bad URL, or the wrong agentId", async () => {
    const bad = await sync({ running: "yes" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_body" } });
    const notJson = await call("/api/agent/sync", {
      method: "POST",
      headers: agentHeaders(),
      body: "{nope",
    });
    expect(notJson.status).toBe(400);
    expect((await sync({ url: "https://evil.com" })).status).toBe(400);
    const mismatch = await sync({ agentId: "other" });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ error: { code: "agent_id_mismatch" } });
  });

  it("200 returns desired, poll interval and server time", async () => {
    const res = await sync();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      desired: "stopped",
      pollIntervalSeconds: 60,
      serverTime: expect.any(Number),
    });
  });

  it("ignores a lastSeen sent by the agent", async () => {
    const cookie = await login();
    await call("/api/agent/sync", {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify({ ...statusBody(), lastSeen: 1 }),
    });
    const { body } = await getControl(cookie);
    expect(body.status.lastSeen).toBeGreaterThan(1_000_000_000_000);
  });

  it("derives events from status changes", async () => {
    const cookie = await login();
    await sync();
    await sync({ running: true, url: "https://one-1.trycloudflare.com", startedAt: 5 });
    await sync({ running: true, url: "https://two-2.trycloudflare.com", startedAt: 5 });
    await sync({ running: false, lastError: "start failed" });
    const types = (await getEvents(cookie)).map((e) => e.type).reverse();
    expect(types).toEqual([
      "agent_online",
      "tunnel_started",
      "url_changed",
      "tunnel_stopped",
      "agent_error",
    ]);
  });
});

describe("GET /api/agent/ws", () => {
  it("401 with a wrong token, 426 without an upgrade header", async () => {
    const wrong = await call("/api/agent/ws", {
      headers: { Authorization: "Bearer nope", Upgrade: "websocket" },
    });
    expect(wrong.status).toBe(401);
    const noUpgrade = await call("/api/agent/ws", { headers: agentHeaders() });
    expect(noUpgrade.status).toBe(426);
  });

  it("delivers a nudge when the desired state changes", async () => {
    const cookie = await login();
    const res = await call("/api/agent/ws", { headers: agentHeaders({ Upgrade: "websocket" }) });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const next = new Promise<string>((resolve) =>
      ws.addEventListener("message", (e) => resolve(e.data as string)),
    );
    expect((await getControl(cookie)).body.agentWsConnected).toBe(true);
    await putDesired(cookie, "running");
    expect(JSON.parse(await next)).toEqual({ type: "nudge" });
    ws.close(1000, "done");
  });

  it("answers ping with pong", async () => {
    const res = await call("/api/agent/ws", { headers: agentHeaders({ Upgrade: "websocket" }) });
    const ws = res.webSocket!;
    ws.accept();
    const next = new Promise<string>((resolve) =>
      ws.addEventListener("message", (e) => resolve(e.data as string)),
    );
    ws.send("ping");
    expect(await next).toBe("pong");
    ws.close(1000, "done");
  });
});

describe("/api/control and /api/events", () => {
  it("401 without a session", async () => {
    expect((await call("/api/control")).status).toBe(401);
    expect(
      (
        await call("/api/control", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "running" }),
        })
      ).status,
    ).toBe(401);
    expect((await call("/api/events")).status).toBe(401);
  });

  it("starts with no status, offline and not pending", async () => {
    const cookie = await login();
    const { body } = await getControl(cookie);
    expect(body).toMatchObject({
      desired: "stopped",
      status: null,
      online: false,
      pending: false,
      agentWsConnected: false,
    });
  });

  it("computes online and pending", async () => {
    const cookie = await login();
    await sync({ running: false });
    expect((await getControl(cookie)).body).toMatchObject({ online: true, pending: false });

    const put = await putDesired(cookie, "running");
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ desired: "running", online: true, pending: true });

    await sync({ running: true, url: "https://abc-1.trycloudflare.com", startedAt: 1 });
    expect((await getControl(cookie)).body).toMatchObject({ pending: false });

    // 200 s later (> 150 s offline threshold) the agent counts as offline
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 200_000 });
    expect((await getControl(cookie)).body).toMatchObject({ online: false, pending: false });
  });

  it("PUT validates the body and writes a desired_changed event", async () => {
    const cookie = await login();
    expect((await putDesired(cookie, "paused")).status).toBe(400);
    await putDesired(cookie, "running", 2);
    const events = await getEvents(cookie);
    expect(events[0]).toMatchObject({ type: "desired_changed" });
  });

  it("starting requires one of the allowed session lengths", async () => {
    const cookie = await login();
    for (const body of [
      { state: "running" },
      { state: "running", durationHours: 3 },
      { state: "running", durationHours: "2" },
      { state: "running", durationHours: 24 },
      { state: "running", durationHours: 0 },
    ]) {
      const res = await putBody(cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_body" } });
    }
    for (const hours of [1, 2, 4, 8, 12]) {
      expect((await putDesired(cookie, "running", hours)).status).toBe(200);
    }
    expect((await putBody(cookie, { state: "stopped" })).status).toBe(200);
  });

  it("exposes expiresAt and ends the session when time is up", async () => {
    const cookie = await login();
    await sync({ running: false });
    const res = await putDesired(cookie, "running", 1);
    const started = (await res.json()) as { expiresAt: number };
    expect(started.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    const syncBody = (await (
      await sync({ running: true, url: "https://s-1.trycloudflare.com", startedAt: 1 })
    ).json()) as {
      desired: string;
      expiresAt: number;
    };
    expect(syncBody).toMatchObject({ desired: "running", expiresAt: started.expiresAt });

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 3_600_000 + 5_000 });
    const after = await sync({ running: true, url: "https://s-1.trycloudflare.com", startedAt: 1 });
    expect(await after.json()).toMatchObject({ desired: "stopped", expiresAt: null });
    expect((await getControl(cookie)).body).toMatchObject({ desired: "stopped", expiresAt: null });
    expect((await getEvents(cookie)).map((e) => e.type)).toContain("session_expired");
  });

  it("GET /api/events validates limit", async () => {
    const cookie = await login();
    const bad = await call("/api/events?limit=500", { headers: { Cookie: cookie } });
    expect(bad.status).toBe(400);
    expect((await getEvents(cookie, 5)).length).toBeLessThanOrEqual(5);
  });
});

describe("auth", () => {
  const post = (password: string, ip = "9.9.9.9") =>
    call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ password }),
    });

  it("wrong password gives 401 and no cookie", async () => {
    const res = await post("wrong-password");
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await res.json()).toMatchObject({ error: { code: "invalid_credentials" } });
  });

  it("the right password sets an httpOnly, SameSite=Lax, Secure cookie for 12h", async () => {
    const res = await post(env.ADMIN_PASSWORD, "8.8.8.8");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toContain("tc_session=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toContain("Max-Age=43200");
  });

  it("400 for a malformed login body", async () => {
    const res = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "7.7.7.7" },
      body: JSON.stringify({ nope: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it("429 after 10 attempts per IP, others are unaffected", async () => {
    for (let i = 0; i < 10; i++) expect((await post("wrong", "6.6.6.6")).status).toBe(401);
    const blocked = await post(env.ADMIN_PASSWORD, "6.6.6.6");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(await blocked.json()).toMatchObject({
      error: { code: "rate_limited", retryAfterSeconds: expect.any(Number) },
    });
    expect((await post(env.ADMIN_PASSWORD, "5.5.5.5")).status).toBe(200);
  });

  it("a successful login resets the counter", async () => {
    for (let i = 0; i < 5; i++) await post("wrong", "4.4.4.4");
    expect((await post(env.ADMIN_PASSWORD, "4.4.4.4")).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await post("wrong", "4.4.4.4")).status).toBe(401);
  });

  it("logout clears the cookie", async () => {
    const res = await call("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/tc_session=;/);
  });
});

describe("misc", () => {
  it("404 JSON for unknown API paths", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
