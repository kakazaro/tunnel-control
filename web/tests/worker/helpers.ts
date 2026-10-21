import { env, exports } from "cloudflare:workers";

export function call(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`https://example.test${path}`, init));
}

export function agentHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${env.AGENT_TOKEN}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function statusBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: "vm-1",
    agentVersion: "0.1.0",
    hostname: "test-vm",
    running: false,
    url: null,
    startedAt: null,
    lastError: null,
    cloudflaredVersion: "2026.1.0",
    ...over,
  };
}

export function sync(over: Record<string, unknown> = {}): Promise<Response> {
  return call("/api/agent/sync", {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify(statusBody(over)),
  });
}

/** Logs in and returns a `Cookie` header value. */
export async function login(ip = "10.0.0.1"): Promise<string> {
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  return setCookie.split(";")[0]!;
}

export function putDesired(cookie: string, state: string, durationHours = 1): Promise<Response> {
  return putBody(cookie, state === "running" ? { state, durationHours } : { state });
}

export function putBody(cookie: string, body: unknown): Promise<Response> {
  return call("/api/control", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

export async function getControl(cookie: string) {
  const res = await call("/api/control", { headers: { Cookie: cookie } });
  return { res, body: (await res.json()) as Record<string, any> };
}

export async function getEvents(cookie: string, limit = 50) {
  const res = await call(`/api/events?limit=${limit}`, { headers: { Cookie: cookie } });
  return ((await res.json()) as { events: Array<{ type: string; message: string }> }).events;
}
