import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";
import App from "../../src/client/App";
import { EffectsProvider } from "../../src/client/hooks/useEffectsLevel";
import { fetcher } from "../../src/client/lib/fetcher";
import { controlBody, installApi, unauthorized, type MockResult } from "./api-mock";

const PASSWORD = "correct-horse";

/** A tiny fake server: session flag + desired state + a couple of events. */
function fakeServer(over: { status?: unknown; online?: boolean } = {}) {
  const state = { authed: false, desired: "stopped", expiresAt: null as number | null };
  const handler = (method: string, url: string, body: unknown): MockResult => {
    if (url === "/auth/login") {
      if ((body as { password: string }).password === PASSWORD) {
        state.authed = true;
        return { status: 200, data: { ok: true } };
      }
      return {
        status: 401,
        data: { error: { code: "invalid_credentials", message: "Access denied." } },
      };
    }
    if (url === "/auth/logout") {
      state.authed = false;
      return { status: 200, data: { ok: true } };
    }
    if (!state.authed) return unauthorized;
    if (url === "/control" && method === "put") {
      const b = body as { state: string; durationHours?: number };
      state.desired = b.state;
      state.expiresAt = b.durationHours ? Date.now() + b.durationHours * 3_600_000 : null;
    }
    if (url === "/control") {
      return {
        status: 200,
        data: controlBody({
          desired: state.desired,
          expiresAt: state.expiresAt,
          status: over.status ?? null,
          online: over.online ?? false,
        }),
      };
    }
    if (url.startsWith("/events")) {
      return {
        status: 200,
        data: {
          events: [{ id: 1, at: Date.now(), type: "agent_online", message: "Agent vm is online" }],
        },
      };
    }
    return { status: 404 };
  };
  return { state, handler };
}

function renderApp() {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        fetcher,
        dedupingInterval: 0,
        shouldRetryOnError: false,
      }}
    >
      <EffectsProvider>
        <App />
      </EffectsProvider>
    </SWRConfig>,
  );
}

async function signIn(user: ReturnType<typeof userEvent.setup>, password = PASSWORD) {
  await user.type(await screen.findByLabelText(/access key/i), password);
  await user.click(screen.getByRole("button", { name: /authenticate/i }));
}

describe("single page: lock, unlock, control", () => {
  it("shows the access terminal when there is no session", async () => {
    installApi(fakeServer().handler);
    renderApp();
    expect(await screen.findByRole("heading", { name: /access terminal/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /engage tunnel/i })).not.toBeInTheDocument();
  });

  it("a wrong password shows ACCESS DENIED and stays locked", async () => {
    installApi(fakeServer().handler);
    renderApp();
    await signIn(userEvent.setup(), "nope");
    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /access terminal/i })).toBeInTheDocument();
  });

  it("shows a lock-out countdown on 429", async () => {
    installApi((_method, url) =>
      url === "/auth/login"
        ? {
            status: 429,
            data: { error: { code: "rate_limited", message: "x", retryAfterSeconds: 30 } },
          }
        : unauthorized,
    );
    renderApp();
    await signIn(userEvent.setup());
    expect(await screen.findByText(/locked out · retry in 30s/i)).toBeInTheDocument();
  });

  it("login unlocks the deck in place (same URL)", async () => {
    installApi(fakeServer().handler);
    renderApp();
    const user = userEvent.setup();
    await signIn(user);

    const reactor = await screen.findByRole(
      "button",
      { name: /engage tunnel/i },
      { timeout: 4000 },
    );
    expect(window.location.pathname).toBe("/");
    expect(reactor).toHaveAttribute("aria-pressed", "false");
    expect((await screen.findAllByText(/agent vm is online/i)).length).toBeGreaterThan(0);
  });

  async function unlocked() {
    const server = fakeServer();
    const api = installApi(server.handler);
    renderApp();
    const user = userEvent.setup();
    await signIn(user);
    const reactor = await screen.findByRole(
      "button",
      { name: /engage tunnel/i },
      { timeout: 4000 },
    );
    return { user, reactor, api };
  }

  it("starting asks for a session length first; it is required", async () => {
    const { user, reactor, api } = await unlocked();
    await user.click(reactor);

    const dialog = await screen.findByRole("dialog", { name: /session time/i });
    // all five lengths are offered, none is preselected, and launch is disabled until one is picked
    for (const h of [1, 2, 4, 8, 12]) {
      const radio = within(dialog).getByRole("radio", { name: new RegExp(`^${h} hours?$`) });
      expect(radio).not.toBeChecked();
    }
    const launch = within(dialog).getByRole("button", { name: /launch session/i });
    expect(launch).toBeDisabled();
    expect(api.calls.some(([m, u]) => m === "put" && u === "/control")).toBe(false);

    await user.click(within(dialog).getByRole("radio", { name: /^2 hours$/ }));
    expect(launch).toBeEnabled();
    await user.click(launch);

    await waitFor(() =>
      expect(api.calls).toContainEqual(["put", "/control", { state: "running", durationHours: 2 }]),
    );
    expect(await screen.findByRole("button", { name: /disengage tunnel/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // the countdown shows about 2 hours
    expect(await screen.findByText(/^0[12]:\d\d:\d\d$/)).toBeInTheDocument();
  });

  it("Escape and Cancel close the dialog without starting anything", async () => {
    const { user, reactor, api } = await unlocked();
    await user.click(reactor);
    await screen.findByRole("dialog", { name: /session time/i });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(reactor);
    await user.click(await screen.findByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.calls.some(([m, u]) => m === "put" && u === "/control")).toBe(false);
  });

  it("stopping is immediate: no dialog", async () => {
    const { user, reactor, api } = await unlocked();
    await user.click(reactor);
    const dialog = await screen.findByRole("dialog", { name: /session time/i });
    await user.click(within(dialog).getByRole("radio", { name: /^1 hour$/ }));
    await user.click(within(dialog).getByRole("button", { name: /launch session/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(await screen.findByRole("button", { name: /disengage tunnel/i }));
    await waitFor(() =>
      expect(api.calls).toContainEqual(["put", "/control", { state: "stopped" }]),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the tunnel URL, status and the public-URL notice when the agent is running", async () => {
    const status = {
      agentId: "vm-1",
      agentVersion: "0.1.0",
      hostname: "rhel-vm",
      running: true,
      url: "https://demo-1.trycloudflare.com",
      startedAt: Date.now() - 65_000,
      lastError: null,
      cloudflaredVersion: "2026.9.1",
      lastSeen: Date.now(),
    };
    const server = fakeServer({ status, online: true });
    server.state.authed = true;
    server.state.desired = "running";
    installApi(server.handler);
    renderApp();

    const statusCard = await screen.findByRole("region", { name: /system status/i });
    expect(await within(statusCard).findByText("ONLINE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /demo-1\.trycloudflare\.com/ })).toHaveAttribute(
      "href",
      "https://demo-1.trycloudflare.com",
    );
    expect(screen.getByText(/quick tunnel urls are public/i)).toBeInTheDocument();
    expect(screen.getByText("2026.9.1")).toBeInTheDocument();
  });

  it("shows lastError in an alert banner", async () => {
    const status = {
      agentId: "vm-1",
      agentVersion: "0.1.0",
      hostname: "rhel-vm",
      running: false,
      url: null,
      startedAt: null,
      lastError: "cloudflared did not print a URL",
      cloudflaredVersion: null,
      lastSeen: Date.now(),
    };
    const server = fakeServer({ status, online: true });
    server.state.authed = true;
    installApi(server.handler);
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent(/cloudflared did not print a URL/);
  });

  it("logout locks the page again", async () => {
    const { handler } = fakeServer();
    installApi(handler);
    renderApp();
    const user = userEvent.setup();
    await signIn(user);
    await screen.findByRole("button", { name: /engage tunnel/i }, { timeout: 4000 });

    await user.click(screen.getByRole("button", { name: /logout/i }));
    expect(await screen.findByRole("heading", { name: /access terminal/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
