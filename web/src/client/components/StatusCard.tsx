import type { ReactNode } from "react";
import { Activity, Loader2, Radio, WifiOff } from "lucide-react";
import type { ControlResponse } from "../../shared/schemas";
import { useChangeKey } from "../hooks/useChangeKey";
import { relativeTime } from "../lib/format";
import { HoloPanel } from "./fx/HoloPanel";
import { SignalBars } from "./fx/SignalBars";

type Props = { data: ControlResponse | undefined; now: number; stale: boolean };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 py-2 last:border-0">
      <dt className="text-xs tracking-widest text-text-muted uppercase">{label}</dt>
      <dd className="m-0 text-right text-sm font-bold">{children}</dd>
    </div>
  );
}

/** Value that flashes softly whenever it changes. */
function Flash({ value, children }: { value: unknown; children: ReactNode }) {
  const key = useChangeKey(value);
  return (
    <span key={key} className={key > 0 ? "flash-change px-1" : "px-1"}>
      {children}
    </span>
  );
}

function AgentBadge({ data }: { data: ControlResponse | undefined }) {
  const key = useChangeKey(data?.online);
  if (!data?.status) {
    return <span className="text-text-muted">NO SIGNAL</span>;
  }
  if (data.online) {
    return (
      <span className="inline-flex items-center gap-2 text-ok">
        <span className="relative grid size-3 place-items-center" aria-hidden="true">
          <span className="ping-ring absolute inset-0 rounded-full bg-ok" />
          <span className="relative size-2 rounded-full bg-ok shadow-[0_0_8px_var(--color-ok)]" />
        </span>
        <span className="glow">ONLINE</span>
      </span>
    );
  }
  return (
    <span key={key} className="flicker-red glitch-once inline-flex items-center gap-2 text-danger">
      <WifiOff className="size-4" aria-hidden="true" />
      <span className="glow">OFFLINE · SIGNAL LOST</span>
    </span>
  );
}

export function StatusCard({ data, now, stale }: Props) {
  const status = data?.status ?? null;
  const tone = data ? (data.online ? "ok" : status ? "danger" : undefined) : undefined;
  const level = !data?.online ? 0 : data.agentWsConnected ? 4 : 1;

  return (
    <HoloPanel
      title="System status"
      icon={<Activity className="size-4" aria-hidden="true" />}
      tone={tone}
      stale={stale}
      aside={stale ? <span className="text-xs text-warn">STALE</span> : null}
    >
      <dl className="m-0">
        <Row label="Agent">
          <AgentBadge data={data} />
        </Row>
        <Row label="Host">
          <span className="text-text">
            {status ? `${status.hostname} · v${status.agentVersion}` : "—"}
          </span>
        </Row>
        <Row label="Link">
          <span
            className={`inline-flex items-center gap-2 ${data?.agentWsConnected ? "text-neon-cyan" : "text-warn"}`}
          >
            <SignalBars
              level={level}
              label={data?.agentWsConnected ? "Live WebSocket link" : "Polling link"}
            />
            {!data?.online ? "—" : data.agentWsConnected ? "LIVE LINK" : "POLLING ~60s"}
          </span>
        </Row>
        <Row label="Last seen">
          <span className="text-text">{status ? relativeTime(status.lastSeen, now) : "—"}</span>
        </Row>
        <Row label="Desired">
          <Flash value={data?.desired}>
            <span
              className={data?.desired === "running" ? "text-ok glow" : "text-neon-magenta glow"}
            >
              {data ? data.desired.toUpperCase() : "—"}
            </span>
          </Flash>
        </Row>
        <Row label="Actual">
          <span className="inline-flex items-center gap-2">
            <Flash value={status?.running}>
              <span className={status?.running ? "text-ok glow" : "text-text-muted"}>
                {status ? (status.running ? "RUNNING" : "STOPPED") : "—"}
              </span>
            </Flash>
            {data?.pending && (
              <span className="inline-flex items-center gap-1 text-xs text-warn">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                SYNCING…
              </span>
            )}
          </span>
        </Row>
        <Row label="Channel">
          <Radio className="inline size-4 text-text-muted" aria-hidden="true" />{" "}
          <span className="text-text-muted">
            {!status ? "�" : data?.agentWsConnected ? "WebSocket" : "HTTPS poll"}
          </span>
        </Row>
      </dl>
    </HoloPanel>
  );
}
