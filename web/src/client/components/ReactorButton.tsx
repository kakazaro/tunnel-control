import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Power } from "lucide-react";
import type { DesiredState } from "../../shared/schemas";

type Props = {
  desired: DesiredState;
  online: boolean;
  pending: boolean;
  /** A PUT /control request is in flight. */
  busy: boolean;
  disabled?: boolean;
  onToggle: (next: DesiredState) => void;
};

type ReactorState = "stopped" | "charging" | "running";

const TEXT: Record<ReactorState, string> = {
  stopped: "text-neon-magenta",
  charging: "text-warn",
  running: "text-ok",
};

function statusText({ desired, online, pending, busy }: Omit<Props, "disabled" | "onToggle">) {
  if (busy) return "TRANSMITTING…";
  if (pending) return desired === "running" ? "ESTABLISHING LINK…" : "POWERING DOWN…";
  if (desired === "running" && !online) return "AWAITING AGENT…";
  return desired === "running" ? "LINK ACTIVE" : "LINK STANDBY";
}

/** The big power control: one real button that starts or stops the tunnel. */
export function ReactorButton(props: Props) {
  const { desired, online, pending, busy, disabled, onToggle } = props;
  const [ripples, setRipples] = useState<number[]>([]);

  const charging = busy || pending || (desired === "running" && !online);
  const state: ReactorState = charging ? "charging" : desired === "running" ? "running" : "stopped";
  const next: DesiredState = desired === "running" ? "stopped" : "running";
  const label = desired === "running" ? "DISENGAGE" : "ENGAGE";

  const click = () => {
    setRipples((r) => [...r, Date.now()]);
    onToggle(next);
  };

  return (
    <div className="flex flex-col items-center gap-5">
      <motion.button
        type="button"
        className="reactor"
        data-state={state}
        aria-pressed={desired === "running"}
        aria-label={`${label.toLowerCase()} tunnel`}
        disabled={disabled || busy}
        onClick={click}
        whileTap={{ scale: 0.94 }}
        transition={{ type: "spring", stiffness: 400, damping: 18 }}
      >
        <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" aria-hidden="true">
          <circle cx="100" cy="100" r="99" strokeWidth="1" opacity="0.35" />
          <circle cx="100" cy="100" r="96" strokeWidth="5" strokeDasharray="1 5.3" opacity="0.7" />
          <circle
            className="ring-a"
            cx="100"
            cy="100"
            r="90"
            strokeWidth="2"
            strokeDasharray="6 10"
          />
          <circle
            className="ring-b"
            cx="100"
            cy="100"
            r="82"
            strokeWidth="1.5"
            strokeDasharray="38 12 8 12"
            opacity="0.8"
          />
          {state === "charging" && (
            <circle
              className="arc"
              cx="100"
              cy="100"
              r="74"
              pathLength="100"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="28 72"
            />
          )}
        </svg>
        <span className="core">
          <span className="flex flex-col items-center gap-2">
            <Power className="size-9" strokeWidth={2.5} aria-hidden="true" />
            <span className="font-display text-[0.62rem] font-black tracking-[0.2em]">{label}</span>
          </span>
        </span>
        <AnimatePresence>
          {ripples.map((id) => (
            <motion.span
              key={id}
              className="ripple"
              initial={{ scale: 0.55, opacity: 0.9 }}
              animate={{ scale: 2.1, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              onAnimationComplete={() => setRipples((r) => r.filter((x) => x !== id))}
            />
          ))}
        </AnimatePresence>
      </motion.button>
      <p
        role="status"
        className={`font-display glow m-0 min-h-6 text-sm font-bold tracking-[0.3em] ${TEXT[state]}`}
      >
        {statusText(props)}
      </p>
    </div>
  );
}
