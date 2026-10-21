import { AxiosError } from "axios";
import { http } from "../../src/client/lib/http";

export type MockResult = { status: number; data?: unknown };
export type MockHandler = (method: string, url: string, body: unknown) => MockResult | "network";

/** Replaces the Axios adapter, so the real interceptors still run. */
export function installApi(handler: MockHandler): { calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = [];
  http.defaults.adapter = async (config) => {
    const method = (config.method ?? "get").toLowerCase();
    const url = config.url ?? "";
    const body = typeof config.data === "string" ? JSON.parse(config.data) : undefined;
    calls.push([method, url, body]);
    const result = handler(method, url, body);
    if (result === "network") throw new AxiosError("Network Error", "ERR_NETWORK", config);
    const response = {
      data: result.data ?? {},
      status: result.status,
      statusText: "",
      headers: {},
      config,
    };
    if (result.status >= 200 && result.status < 300) return response;
    throw new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response);
  };
  return { calls };
}

export const controlBody = (over: Record<string, unknown> = {}) => ({
  desired: "stopped",
  expiresAt: null,
  status: null,
  online: false,
  pending: false,
  agentWsConnected: false,
  serverTime: Date.now(),
  ...over,
});

export const unauthorized = {
  status: 401,
  data: { error: { code: "unauthorized", message: "Sign in required." } },
};
