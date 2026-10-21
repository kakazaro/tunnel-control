import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { Hourglass, Rocket, X } from "lucide-react";
import { SESSION_HOURS, type SessionHours } from "../../shared/schemas";
import { useEffectsLevel } from "../hooks/useEffectsLevel";
import { Burst } from "./fx/Burst";

type Props = {
  onConfirm: (hours: SessionHours) => void;
  onCancel: () => void;
};

/**
 * "Choose a session length" dialog. A length is REQUIRED: nothing is preselected and the
 * launch button stays disabled until one is picked. Esc, the backdrop and Cancel close it.
 */
export function SessionModal({ onConfirm, onCancel }: Props) {
  const { isFull } = useEffectsLevel();
  const titleId = useId();
  const descId = useId();
  const [hours, setHours] = useState<SessionHours | null>(null);
  const [launching, setLaunching] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const firstOption = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstOption.current?.focus();
    return () => previous?.focus();
  }, []);

  const launch = () => {
    if (hours === null || launching) return;
    setLaunching(true);
    // Let the burst play before the dialog closes.
    window.setTimeout(() => onConfirm(hours), isFull ? 380 : 0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    // Keep the focus inside the dialog.
    const items = panel.current.querySelectorAll<HTMLElement>(
      "input:not([disabled]), button:not([disabled])",
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: isFull ? 0.25 : 0 } }}
      transition={{ duration: 0.2 }}
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onCancel}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="holo crt-on relative w-full max-w-lg p-6"
        initial={{ opacity: 0, scale: 0.9, y: 24, filter: "blur(8px)" }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
        exit={{
          opacity: 0,
          scale: 0.96,
          filter: "blur(6px)",
          transition: { duration: isFull ? 0.25 : 0 },
        }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
      >
        <span className="bracket tl" />
        <span className="bracket tr" />
        <span className="bracket bl" />
        <span className="bracket br" />

        <button
          type="button"
          className="neon-btn absolute top-3 right-3 !min-h-9 !px-2"
          onClick={onCancel}
          aria-label="Close"
        >
          <X className="size-4" aria-hidden="true" />
        </button>

        <h2
          id={titleId}
          className="font-display glow m-0 mb-1 flex items-center gap-2 text-sm font-black tracking-[0.26em] text-neon-cyan"
        >
          <Hourglass className="size-4" aria-hidden="true" />
          SESSION TIME
        </h2>
        <p id={descId} className="m-0 mb-5 text-sm text-text-muted">
          Choose how long the tunnel stays open. It stops automatically when time is up. Required.
        </p>

        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">Session length</legend>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {SESSION_HOURS.map((h, i) => {
              const selected = hours === h;
              return (
                <label
                  key={h}
                  className="relative cursor-pointer select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-neon-cyan"
                >
                  <input
                    ref={i === 0 ? firstOption : undefined}
                    type="radio"
                    name="session-hours"
                    value={h}
                    aria-label={`${h} ${h === 1 ? "hour" : "hours"}`}
                    checked={selected}
                    onChange={() => setHours(h)}
                    className="sr-only"
                  />
                  <span
                    className={`relative grid h-20 place-items-center overflow-hidden rounded-sm border text-center transition-colors ${selected ? "border-neon-cyan text-neon-cyan" : "border-line text-text hover:border-line-strong"}`}
                  >
                    {selected && (
                      <motion.span
                        layoutId="session-highlight"
                        className="glow-box absolute inset-0 bg-neon-cyan/15"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <span className="relative flex flex-col items-center">
                      <span
                        className={`font-display text-3xl font-black ${selected ? "glow" : ""}`}
                      >
                        {h}
                      </span>
                      <span className="text-xs tracking-widest text-text-muted uppercase">
                        {h === 1 ? "hour" : "hours"}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <p className="m-0 mt-4 min-h-5 text-xs text-text-muted" role="status">
          {hours === null
            ? "Select a session length to continue."
            : `Tunnel closes after ${hours} h.`}
        </p>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="neon-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="neon-btn !border-ok/70 !text-ok"
            onClick={launch}
            disabled={hours === null || launching}
          >
            <Rocket className="size-4" aria-hidden="true" />
            Launch session
          </button>
        </div>

        {launching && <Burst color="var(--color-ok)" count={20} />}
      </motion.div>
    </motion.div>
  );
}
