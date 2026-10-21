import { DurableObject } from "cloudflare:workers";
import {
  DesiredSchema,
  AgentStatusSchema,
  type AgentStatus,
  type AgentStatusInput,
  type Desired,
  type DesiredState,
  type SessionHours,
  type EventType,
  type TunnelEvent,
  type WsMessage,
} from "../shared/schemas";
import { getTiming } from "./env";

const MAX_EVENTS = 100;
const WS_TAG = "agent";

type EventData = NonNullable<TunnelEvent["data"]>;

/**
 * One instance per agent id (plus one named "auth" for the login rate limiter).
 * Owns all persistent state and the agent's WebSocket. Nothing else touches storage.
 */
export class AgentHub extends DurableObject<Cloudflare.Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_start INTEGER NOT NULL
      );
    `);
    // Idle connections answer "ping" with "pong" without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---- key/value helpers -------------------------------------------------

  private getKv(key: string): string | null {
    const rows = this.sql
      .exec<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)
      .toArray();
    return rows[0]?.value ?? null;
  }

  private setKv(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private addEvent(type: EventType, message: string, data?: EventData, at = Date.now()): void {
    this.sql.exec(
      "INSERT INTO events (at, type, message, data) VALUES (?, ?, ?, ?)",
      at,
      type,
      message,
      data ? JSON.stringify(data) : null,
    );
    // Keep only the newest MAX_EVENTS rows (ids only ever grow).
    this.sql.exec("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?", MAX_EVENTS);
  }

  private readStatus(): AgentStatus | null {
    const raw = this.getKv("status");
    if (!raw) return null;
    const parsed = AgentStatusSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  private offlineMs(): number {
    return getTiming(this.env).AGENT_OFFLINE_AFTER_SECONDS * 1000;
  }

  // ---- desired state -----------------------------------------------------

  /** The desired state, after applying session expiry (so a late alarm never matters). */
  getDesired(): Desired {
    this.expireIfNeeded();
    return this.readDesired();
  }

  private readDesired(): Desired {
    const raw = this.getKv("desired");
    if (raw) {
      const parsed = DesiredSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
    return { state: "stopped", updatedAt: 0, expiresAt: null };
  }

  /** Ends a running session whose time is up: desired becomes "stopped" and the agent is nudged. */
  private expireIfNeeded(now = Date.now()): void {
    const current = this.readDesired();
    if (current.state !== "running" || current.expiresAt === null || now < current.expiresAt) {
      return;
    }
    this.setKv(
      "desired",
      JSON.stringify({ state: "stopped", updatedAt: now, expiresAt: null } satisfies Desired),
    );
    this.addEvent("session_expired", "Session time is up: tunnel stopping", { endedAt: now }, now);
    this.nudge();
  }

  /** Starting requires a session length (the Worker validates it); stopping takes none.
   * (No overloads: the Workers RPC types only see the last one.) */
  async setDesired(state: DesiredState, durationHours?: SessionHours): Promise<Desired> {
    this.expireIfNeeded();
    const current = this.readDesired();
    const now = Date.now();

    if (state === "running") {
      if (durationHours === undefined) return current; // unreachable: the Worker validates the body
      const next: Desired = {
        state,
        updatedAt: now,
        expiresAt: now + durationHours * 3_600_000,
      };
      this.setKv("desired", JSON.stringify(next));
      this.addEvent(
        "desired_changed",
        current.state === "running"
          ? `Session restarted for ${durationHours}h`
          : `Desired state set to running for ${durationHours}h`,
        { state, durationHours },
        now,
      );
      if (current.state !== "running") this.nudge();
      await this.rearm();
      return next;
    }

    if (current.state === "stopped") return current;
    const next: Desired = { state, updatedAt: now, expiresAt: null };
    this.setKv("desired", JSON.stringify(next));
    this.addEvent("desired_changed", "Desired state set to stopped", { state }, now);
    this.nudge();
    await this.rearm();
    return next;
  }

  // ---- alarm: the next of "agent went offline" and "session ends" ---------

  private async rearm(): Promise<void> {
    const times: number[] = [];
    const status = this.readStatus();
    if (status && this.getKv("wasOnline") === "1") times.push(status.lastSeen + this.offlineMs());
    const desired = this.readDesired();
    if (desired.state === "running" && desired.expiresAt !== null) times.push(desired.expiresAt);
    if (times.length > 0) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.expireIfNeeded(now);

    const status = this.readStatus();
    if (status && this.getKv("wasOnline") === "1" && now >= status.lastSeen + this.offlineMs()) {
      this.setKv("wasOnline", "0");
      this.addEvent(
        "agent_offline_detected",
        "Agent stopped reporting",
        { lastSeen: status.lastSeen },
        now,
      );
    }
    await this.rearm();
  }

  // ---- agent sync --------------------------------------------------------

  async sync(input: AgentStatusInput): Promise<{ desired: Desired }> {
    const now = Date.now();
    this.expireIfNeeded(now);
    const prev = this.readStatus();

    if (this.getKv("wasOnline") !== "1") {
      this.addEvent(
        "agent_online",
        `Agent ${input.hostname} is online`,
        { hostname: input.hostname },
        now,
      );
      this.setKv("wasOnline", "1");
    }

    const wasRunning = prev?.running ?? false;
    if (input.running && !wasRunning) {
      this.addEvent(
        "tunnel_started",
        `Tunnel started: ${input.url ?? "URL pending"}`,
        { url: input.url },
        now,
      );
    } else if (!input.running && wasRunning) {
      this.addEvent("tunnel_stopped", "Tunnel stopped", undefined, now);
    } else if (input.running && wasRunning && prev?.url !== input.url) {
      this.addEvent(
        "url_changed",
        `Tunnel URL changed: ${input.url ?? "none"}`,
        { url: input.url },
        now,
      );
    }

    if (input.lastError && input.lastError !== prev?.lastError) {
      this.addEvent("agent_error", input.lastError, undefined, now);
    }

    const status: AgentStatus = { ...input, lastSeen: now };
    this.setKv("status", JSON.stringify(status));
    await this.rearm();

    return { desired: this.readDesired() };
  }

  // ---- reads -------------------------------------------------------------

  getControl(): { desired: Desired; status: AgentStatus | null; agentWsConnected: boolean } {
    return {
      desired: this.getDesired(),
      status: this.readStatus(),
      agentWsConnected: this.ctx.getWebSockets(WS_TAG).length > 0,
    };
  }

  listEvents(limit: number): TunnelEvent[] {
    const rows = this.sql
      .exec<{
        id: number;
        at: number;
        type: EventType;
        message: string;
        data: string | null;
      }>(
        "SELECT id, at, type, message, data FROM events ORDER BY id DESC LIMIT ?",
        Math.max(1, Math.min(limit, MAX_EVENTS)),
      )
      .toArray();
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      type: r.type,
      message: r.message,
      ...(r.data ? { data: JSON.parse(r.data) as EventData } : {}),
    }));
  }

  // ---- login rate limit (used on the "auth" instance) --------------------

  hitRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    this.sql.exec("DELETE FROM rate_limits WHERE window_start <= ?", now - windowMs);
    const row = this.sql
      .exec<{ count: number; window_start: number }>(
        "SELECT count, window_start FROM rate_limits WHERE key = ?",
        key,
      )
      .toArray()[0];

    if (!row) {
      this.sql.exec(
        "INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)",
        key,
        now,
      );
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }
    if (row.count >= limit) {
      const retry = Math.ceil((row.window_start + windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retry) };
    }
    this.sql.exec("UPDATE rate_limits SET count = count + 1 WHERE key = ?", key);
    return { allowed: true, remaining: limit - row.count - 1, retryAfterSeconds: 0 };
  }

  resetRateLimit(key: string): void {
    this.sql.exec("DELETE FROM rate_limits WHERE key = ?", key);
  }

  // ---- WebSocket (agent nudges) ------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    // A new agent connection replaces any older one.
    for (const old of this.ctx.getWebSockets(WS_TAG)) {
      try {
        old.close(1000, "replaced");
      } catch {
        /* already closed */
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [WS_TAG]);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(): void {
    // Only "ping" is expected and it is answered automatically. Ignore anything else.
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      // 1005/1006/1015 are reserved and cannot be sent in a close frame.
      ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, "closing");
    } catch {
      /* already closed */
    }
  }

  private nudge(): void {
    const message: WsMessage = { type: "nudge" };
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets(WS_TAG)) {
      try {
        ws.send(text);
      } catch {
        /* the socket is closing; the agent re-syncs when it reconnects */
      }
    }
  }
}
