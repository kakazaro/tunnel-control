import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError, http } from "../../src/client/lib/http";
import { useSessionLocked } from "../../src/client/lib/session";
import { installApi } from "./api-mock";

describe("http interceptor", () => {
  it("locks the page on a 401 from a normal endpoint", async () => {
    installApi(() => ({
      status: 401,
      data: { error: { code: "unauthorized", message: "Sign in." } },
    }));
    const hook = renderHook(() => useSessionLocked());
    expect(hook.result.current).toBe(false);
    await expect(http.get("/control")).rejects.toMatchObject({ status: 401 });
    hook.rerender();
    expect(hook.result.current).toBe(true);
  });

  it("does NOT lock on a 401 from /auth/login (a wrong password)", async () => {
    installApi(() => ({
      status: 401,
      data: { error: { code: "invalid_credentials", message: "No." } },
    }));
    const hook = renderHook(() => useSessionLocked());
    await expect(http.post("/auth/login", { password: "x" })).rejects.toBeInstanceOf(ApiError);
    hook.rerender();
    expect(hook.result.current).toBe(false);
  });

  it("maps server errors, retry-after and network failures to ApiError", async () => {
    installApi(() => ({
      status: 429,
      data: { error: { code: "rate_limited", message: "Too many.", retryAfterSeconds: 42 } },
    }));
    await expect(http.post("/auth/login", {})).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 42,
    });

    installApi(() => "network");
    await expect(http.get("/control")).rejects.toMatchObject({ status: 0, code: "network" });
  });
});
