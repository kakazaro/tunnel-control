import { z } from "zod";

/** Quick Tunnel URLs only: https://<random>.trycloudflare.com */
export const TUNNEL_URL_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

export const DesiredStateSchema = z.enum(["running", "stopped"]);
export type DesiredState = z.infer<typeof DesiredStateSchema>;

/** Session lengths the UI offers (hours). Starting a tunnel requires one of them. */
export const SESSION_HOURS = [1, 2, 4, 8, 12] as const;
export type SessionHours = (typeof SESSION_HOURS)[number];
export const SessionHoursSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(8),
  z.literal(12),
]);

export const DesiredSchema = z.object({
  state: DesiredStateSchema,
  updatedAt: z.number(),
  /** Epoch ms when a running session ends (the tunnel is stopped automatically); null otherwise. */
  expiresAt: z.number().nullable().default(null),
});
export type Desired = z.infer<typeof DesiredSchema>;

/** What the agent sends on every sync. `lastSeen` is NOT accepted: the server owns time. */
export const AgentStatusInputSchema = z.object({
  agentId: z.string().min(1).max(64),
  agentVersion: z.string().max(32),
  hostname: z.string().max(255),
  running: z.boolean(),
  url: z.string().max(200).regex(TUNNEL_URL_RE).nullable(),
  startedAt: z.number().int().nonnegative().nullable(),
  lastError: z.string().max(2000).nullable(),
  cloudflaredVersion: z.string().max(100).nullable(),
});
export type AgentStatusInput = z.infer<typeof AgentStatusInputSchema>;

export const AgentStatusSchema = AgentStatusInputSchema.extend({
  lastSeen: z.number(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const EventTypeSchema = z.enum([
  "desired_changed",
  "tunnel_started",
  "tunnel_stopped",
  "url_changed",
  "agent_error",
  "agent_online",
  "agent_offline_detected",
  "session_expired",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  /** Increasing row id: a stable key for the UI. */
  id: z.number(),
  at: z.number(),
  type: EventTypeSchema,
  message: z.string(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export type TunnelEvent = z.infer<typeof EventSchema>;

export const SyncResponseSchema = z.object({
  desired: DesiredStateSchema,
  /** Epoch ms (server time) when the running session ends, or null. */
  expiresAt: z.number().nullable(),
  pollIntervalSeconds: z.number(),
  serverTime: z.number(),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

export const ControlResponseSchema = z.object({
  desired: DesiredStateSchema,
  /** Epoch ms when the running session ends, or null. */
  expiresAt: z.number().nullable(),
  status: AgentStatusSchema.nullable(),
  online: z.boolean(),
  pending: z.boolean(),
  agentWsConnected: z.boolean(),
  serverTime: z.number(),
});
export type ControlResponse = z.infer<typeof ControlResponseSchema>;

/** Starting needs a session length; stopping does not. */
export const SetDesiredBodySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("running"), durationHours: SessionHoursSchema }),
  z.object({ state: z.literal("stopped") }),
]);
export type SetDesiredBody = z.infer<typeof SetDesiredBodySchema>;

export const LoginBodySchema = z.object({ password: z.string().min(1).max(256) });

export const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const EventsResponseSchema = z.object({ events: z.array(EventSchema) });
export type EventsResponse = z.infer<typeof EventsResponseSchema>;

/** Messages the server sends to the agent over the WebSocket. */
export const WsMessageSchema = z.object({ type: z.literal("nudge") });
export type WsMessage = z.infer<typeof WsMessageSchema>;

export type ApiErrorBody = {
  error: { code: string; message: string; retryAfterSeconds?: number };
};
