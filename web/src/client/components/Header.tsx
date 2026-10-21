import { useEffect, useState } from "react";
import { Maximize, Minimize, LogOut, Sparkle, Sparkles } from "lucide-react";
import { useEffectsLevel } from "../hooks/useEffectsLevel";

type Props = { unlocked: boolean; syncing: boolean; onLogout: () => void };

function useFullscreen() {
  const supported = typeof document !== "undefined" && document.fullscreenEnabled;
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  return { supported, active, toggle };
}

export function Header({ unlocked, syncing, onLogout }: Props) {
  const fx = useEffectsLevel();
  const fullscreen = useFullscreen();

  return (
    <header className="relative z-20 flex items-center justify-between gap-3 border-b border-line/70 bg-bg/40 px-3 py-2 backdrop-blur sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <svg
          viewBox="0 0 64 64"
          className="size-7 shrink-0 text-neon-cyan sm:size-8"
          aria-hidden="true"
        >
          <circle
            cx="32"
            cy="32"
            r="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray="8 5"
          />
          <circle cx="32" cy="32" r="8" fill="var(--color-neon-magenta)" />
        </svg>
        <h1 className="font-display glow m-0 truncate text-[0.7rem] font-black tracking-[0.16em] text-neon-cyan sm:text-base sm:tracking-[0.28em]">
          TUNNEL<span className="text-neon-magenta">//</span>CONTROL
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <span
          role="status"
          className="mr-1 hidden items-center gap-2 text-xs text-text-muted sm:inline-flex"
        >
          <span
            className={`size-2 rounded-full ${syncing ? "animate-pulse bg-neon-cyan shadow-[0_0_8px_var(--color-neon-cyan)]" : "bg-text-muted/50"}`}
            aria-hidden="true"
          />
          {unlocked ? (syncing ? "SYNC" : "IDLE") : "LOCKED"}
        </span>

        <button
          type="button"
          className="neon-btn !px-3"
          onClick={fx.toggle}
          disabled={fx.systemForced}
          aria-pressed={fx.isFull}
          title={fx.systemForced ? "Reduced motion is set by your system" : "Toggle visual effects"}
        >
          {fx.isFull ? (
            <Sparkles className="size-4" aria-hidden="true" />
          ) : (
            <Sparkle className="size-4 opacity-60" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">FX: {fx.isFull ? "FULL" : "REDUCED"}</span>
          <span className="sr-only sm:hidden">Effects {fx.isFull ? "full" : "reduced"}</span>
        </button>

        {fullscreen.supported && (
          <button
            type="button"
            className="neon-btn !px-3"
            onClick={fullscreen.toggle}
            aria-label={fullscreen.active ? "Exit full screen" : "Enter full screen"}
          >
            {fullscreen.active ? (
              <Minimize className="size-4" aria-hidden="true" />
            ) : (
              <Maximize className="size-4" aria-hidden="true" />
            )}
          </button>
        )}

        {unlocked && (
          <button type="button" className="neon-btn danger !px-3" onClick={onLogout}>
            <LogOut className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Logout</span>
            <span className="sr-only sm:hidden">Logout</span>
          </button>
        )}
      </div>
    </header>
  );
}
