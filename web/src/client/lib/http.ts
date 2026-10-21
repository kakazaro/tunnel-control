import axios, { isAxiosError } from "axios";
import type { ApiErrorBody } from "../../shared/schemas";
import { lockSession } from "./session";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, message: string, code = "error", retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isAxiosError<ApiErrorBody>(error)) {
    const body = error.response?.data?.error;
    if (error.response) {
      return new ApiError(
        error.response.status,
        body?.message ?? error.message,
        body?.code,
        body?.retryAfterSeconds,
      );
    }
    // No response: network down, timeout, blocked.
    return new ApiError(0, "Cannot reach the server.", "network");
  }
  return new ApiError(0, error instanceof Error ? error.message : "Unknown error", "unknown");
}

export const http = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 10_000,
  headers: { "Content-Type": "application/json" },
});

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiError(error);
    const url = isAxiosError(error) ? (error.config?.url ?? "") : "";
    // A wrong password is a 401 too: it must show "ACCESS DENIED", not lock the page.
    if (apiError.status === 401 && !url.startsWith("/auth/")) lockSession();
    return Promise.reject(apiError);
  },
);
