import { z } from "zod";

const TimingSchema = z.object({
  AGENT_ID: z.string().min(1).max(64).default("vm-1"),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  AGENT_OFFLINE_AFTER_SECONDS: z.coerce.number().int().min(30).max(3600).default(150),
  /** Fixed delay after a wrong password. Tests set it to 0. */
  LOGIN_FAILURE_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(1000),
});

const SecretsSchema = z.object({
  AGENT_TOKEN: z.string().min(32, "must be at least 32 characters"),
  ADMIN_PASSWORD: z.string().min(12, "must be at least 12 characters"),
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
});

export type Timing = z.infer<typeof TimingSchema>;
export type AppConfig = Timing & z.infer<typeof SecretsSchema>;

/** Timing settings only. Safe to call without secrets (the Durable Object uses it). */
export function getTiming(env: unknown): Timing {
  return TimingSchema.parse(env);
}

type ConfigResult = { ok: true; config: AppConfig } | { ok: false; issues: string[] };

const cache = new WeakMap<object, ConfigResult>();

/** Validates vars + secrets once per env object. Issues name the variable, never its value. */
export function getConfig(env: unknown): ConfigResult {
  const key = env as object;
  const hit = cache.get(key);
  if (hit) return hit;

  const timing = TimingSchema.safeParse(env);
  const secrets = SecretsSchema.safeParse(env);
  let result: ConfigResult;
  if (timing.success && secrets.success) {
    result = { ok: true, config: { ...timing.data, ...secrets.data } };
  } else {
    const issues = [timing, secrets].flatMap((r) =>
      r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
    result = { ok: false, issues };
  }
  cache.set(key, result);
  return result;
}
