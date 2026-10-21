import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  AgentStatusInputSchema,
  EventsQuerySchema,
  LoginBodySchema,
  SetDesiredBodySchema,
  type ApiErrorBody,
  type ControlResponse,
  type SyncResponse,
} from "../shared/schemas";
import { AgentHub } from "./agent-hub";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  bearerMatches,
  safeEqual,
  signSession,
  verifySession,
} from "./auth";
import { getConfig, type AppConfig } from "./env";

export { AgentHub };

type AppEnv = { Bindings: Cloudflare.Env; Variables: { config: AppConfig } };
type Ctx = Context<AppEnv>;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;

function fail(
  c: Ctx,
  status: 400 | 401 | 404 | 426 | 429 | 500,
  code: string,
  message: string,
  extra?: { retryAfterSeconds?: number },
) {
  const body: ApiErrorBody = { error: { code, message, ...extra } };
  return c.json(body, status);
}

function hub(c: Ctx, name: string) {
  return c.env.AGENT_HUB.get(c.env.AGENT_HUB.idFromName(name));
}

const app = new Hono<AppEnv>();

// Liveness: no auth, no secrets, works even before secrets are configured.
app.get("/api/health", (c) => c.json({ ok: true }, 200, NO_STORE));

// Everything below needs valid configuration.
app.use("/api/*", async (c, next) => {
  const result = getConfig(c.env);
  if (!result.ok) {
    console.error("Misconfigured Worker:", result.issues.join("; "));
    return fail(c, 500, "misconfigured", "The server is not configured correctly.");
  }
  c.set("config", result.config);
  await next();
  // Do not touch the headers of a WebSocket upgrade response.
  if (!c.req.header("Upgrade")) c.header("Cache-Control", "no-store");
});

const requireAgent: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await bearerMatches(c.req.header("Authorization"), c.var.config.AGENT_TOKEN))) {
    c.header("WWW-Authenticate", "Bearer");
    return fail(c, 401, "unauthorized", "Missing or invalid agent token.");
  }
  await next();
};

const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await verifySession(getCookie(c, SESSION_COOKIE), c.var.config.SESSION_SECRET))) {
    return fail(c, 401, "unauthorized", "Sign in required.");
  }
  await next();
};

// ---- agent -----------------------------------------------------------------

app.post("/api/agent/sync", requireAgent, async (c) => {
  const parsed = AgentStatusInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return fail(c, 400, "invalid_body", issues.join("; "));
  }
  const { AGENT_ID, POLL_INTERVAL_SECONDS } = c.var.config;
  if (parsed.data.agentId !== AGENT_ID) {
    return fail(c, 400, "agent_id_mismatch", `This server only accepts agentId "${AGENT_ID}".`);
  }
  const { desired } = await hub(c, AGENT_ID).sync(parsed.data);
  const body: SyncResponse = {
    desired: desired.state,
    expiresAt: desired.expiresAt,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    serverTime: Date.now(),
  };
  return c.json(body);
});

app.get("/api/agent/ws", requireAgent, async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return fail(c, 426, "upgrade_required", "Expected a WebSocket upgrade.");
  }
  return hub(c, c.var.config.AGENT_ID).fetch(c.req.raw);
});

// ---- control (session) -----------------------------------------------------

app.use("/api/control", requireSession);
app.use("/api/events", requireSession);

async function controlResponse(c: Ctx) {
  const { AGENT_ID, AGENT_OFFLINE_AFTER_SECONDS } = c.var.config;
  const { desired, status, agentWsConnected } = await hub(c, AGENT_ID).getControl();
  const now = Date.now();
  const online = status !== null && now - status.lastSeen < AGENT_OFFLINE_AFTER_SECONDS * 1000;
  const body: ControlResponse = {
    desired: desired.state,
    expiresAt: desired.expiresAt,
    status,
    online,
    pending: online && status !== null && (desired.state === "running") !== status.running,
    agentWsConnected,
    serverTime: now,
  };
  return c.json(body);
}

app.get("/api/control", controlResponse);

app.put("/api/control", async (c) => {
  const parsed = SetDesiredBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      c,
      400,
      "invalid_body",
      'Expected {"state":"stopped"} or {"state":"running","durationHours":1|2|4|8|12}.',
    );
  }
  const body = parsed.data;
  const agent = hub(c, c.var.config.AGENT_ID);
  await agent.setDesired(body.state, body.state === "running" ? body.durationHours : undefined);
  return controlResponse(c);
});

app.get("/api/events", async (c) => {
  const parsed = EventsQuerySchema.safeParse({ limit: c.req.query("limit") });
  if (!parsed.success) {
    return fail(c, 400, "invalid_query", "limit must be an integer from 1 to 100.");
  }
  return c.json({ events: await hub(c, c.var.config.AGENT_ID).listEvents(parsed.data.limit) });
});

// ---- auth ------------------------------------------------------------------

app.post("/api/auth/login", async (c) => {
  const { ADMIN_PASSWORD, SESSION_SECRET, LOGIN_FAILURE_DELAY_MS } = c.var.config;
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const limiterKey = `login:${ip}`;
  const limiter = hub(c, "auth");

  const rate = await limiter.hitRateLimit(limiterKey, LOGIN_LIMIT, LOGIN_WINDOW_SECONDS);
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfterSeconds));
    return fail(c, 429, "rate_limited", "Too many attempts. Try again later.", {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const parsed = LoginBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, 400, "invalid_body", 'Expected { "password": string }.');

  if (!(await safeEqual(parsed.data.password, ADMIN_PASSWORD))) {
    // A timer, not CPU: slows guessing without costing CPU time.
    await new Promise((resolve) => setTimeout(resolve, LOGIN_FAILURE_DELAY_MS));
    return fail(c, 401, "invalid_credentials", "Access denied.");
  }

  await limiter.resetRateLimit(limiterKey);
  setCookie(c, SESSION_COOKIE, await signSession(SESSION_SECRET), {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.json({ ok: true });
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.notFound((c) =>
  c.req.path.startsWith("/api/")
    ? fail(c, 404, "not_found", "No such endpoint.")
    : c.text("Not found", 404),
);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return fail(c, 500, "internal", "Internal server error.");
});

export default app;
