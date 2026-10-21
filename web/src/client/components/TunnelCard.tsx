import { useState } from "react";
import { Check, Copy, ExternalLink, Globe, ShieldAlert } from "lucide-react";
import type { ControlResponse } from "../../shared/schemas";
import { useChangeKey } from "../hooks/useChangeKey";
import { formatUptime } from "../lib/format";
import { HoloPanel } from "./fx/HoloPanel";
import { ScrambleText } from "./fx/ScrambleText";

type Props = { data: ControlResponse | undefined; now: number; stale: boolean };

export function TunnelCard({ data, now, stale }: Props) {
  const status = data?.status ?? null;
  const url = status?.running ? status.url : null;
  const beamKey = useChangeKey(url);
  const [copy, setCopy] = useState<"idle" | "ok" | "fail">("idle");

  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopy("ok");
    } catch {
      setCopy("fail");
    }
    window.setTimeout(() => setCopy("idle"), 1800);
  };

  const sessionLeft =
    data?.desired === "running" && data.expiresAt !== null
      ? Math.max(0, data.expiresAt - now)
      : null;
  const uptime = status?.running && status.startedAt ? formatUptime(now - status.startedAt) : null;

  return (
    <HoloPanel
      title="Tunnel"
      icon={<Globe className="size-4" aria-hidden="true" />}
      stale={stale}
      className="min-h-0"
    >
      {beamKey > 0 && <span key={beamKey} className="beam" aria-hidden="true" />}
      <div className="flex min-h-0 flex-col gap-3">
        <div>
          <p className="mb-1 text-xs tracking-widest text-text-muted uppercase">Public URL</p>
          <div className="flex items-start gap-2">
            <div
              key={beamKey}
              className={`min-w-0 flex-1 text-sm font-bold break-all ${beamKey > 0 && url ? "glitch-once" : ""}`}
            >
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neon-cyan glow inline-flex items-start gap-1 underline decoration-dotted underline-offset-4"
                >
                  <ScrambleText text={url} />
                  <ExternalLink
                    className="mt-0.5 size-4 shrink-0"
                    aria-label="opens in a new tab"
                  />
                </a>
              ) : (
                <span className="text-text-muted">
                  <ScrambleText text={data ? "— OFFLINE —" : "— NO SIGNAL —"} />
                </span>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                className="neon-btn !px-3"
                onClick={copyUrl}
                disabled={!url}
                aria-label="Copy tunnel URL"
              >
                {copy === "ok" ? (
                  <Check className="size-4 text-ok" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </button>
              {copy !== "idle" && (
                <span
                  role="status"
                  className={`toast-float font-display absolute -top-2 right-0 -translate-y-full rounded-sm border px-2 py-1 text-[0.65rem] font-bold tracking-widest whitespace-nowrap ${copy === "ok" ? "border-ok/60 bg-bg-raised text-ok" : "border-danger/60 bg-bg-raised text-danger"}`}
                >
                  {copy === "ok" ? "COPIED" : "COPY FAILED"}
                </span>
              )}
            </div>
          </div>
        </div>

        <dl className="m-0 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs tracking-widest text-text-muted uppercase">Uptime</dt>
            <dd className="font-display m-0 text-xl font-bold tracking-wider tabular-nums text-text">
              {uptime ?? "--:--:--"}
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-widest text-text-muted uppercase">Session left</dt>
            <dd
              className={`font-display m-0 text-xl font-bold tracking-wider tabular-nums ${sessionLeft !== null && sessionLeft <= 300_000 ? "flicker-red text-warn" : "text-text"}`}
            >
              {sessionLeft !== null ? formatUptime(sessionLeft) : "--:--:--"}
            </dd>
          </div>
          <div>
            <dt className="text-xs tracking-widest text-text-muted uppercase">cloudflared</dt>
            <dd className="m-0 text-sm text-text">{status?.cloudflaredVersion ?? "—"}</dd>
          </div>
        </dl>

        <p className="m-0 flex gap-2 border-t border-line/60 pt-3 text-xs text-warn">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Quick Tunnel URLs are public and change on every restart. Anyone with the URL can reach
          the app on port 8080.
        </p>
      </div>
    </HoloPanel>
  );
}
