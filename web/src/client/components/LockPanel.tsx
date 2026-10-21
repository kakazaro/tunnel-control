import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { KeyRound, Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { useLogin } from "../hooks/useAuth";
import { useEffectsLevel } from "../hooks/useEffectsLevel";
import { ApiError } from "../lib/http";
import { Burst } from "./fx/Burst";
import { TypeLines } from "./fx/TypeLines";

type Phase = "idle" | "pending" | "denied" | "lockedOut" | "error" | "granted";

const BOOT = [
  "> TUNNEL//CONTROL  v0.1",
  "> LINK TO CORE ........ STANDBY",
  "> AUTHENTICATION REQUIRED",
];

type Props = { onGranted: () => void };

/** The "ACCESS TERMINAL": the login form, floating over the dormant deck. */
export function LockPanel({ onGranted }: Props) {
  const { isFull } = useEffectsLevel();
  const { trigger } = useLogin();
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [attempt, setAttempt] = useState(0);
  const [retryLeft, setRetryLeft] = useState(0);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Lock-out countdown.
  useEffect(() => {
    if (phase !== "lockedOut") return;
    const id = window.setInterval(() => {
      setRetryLeft((n) => {
        if (n <= 1) {
          window.clearInterval(id);
          setPhase("idle");
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // After "ACCESS GRANTED", let the burst play, then hand over to the deck.
  useEffect(() => {
    if (phase !== "granted") return;
    const id = window.setTimeout(onGranted, isFull ? 1100 : 0);
    return () => window.clearTimeout(id);
  }, [phase, isFull, onGranted]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || phase === "pending" || phase === "lockedOut") return;
    setPhase("pending");
    try {
      await trigger(password);
      setPassword("");
      setPhase("granted");
    } catch (err) {
      setAttempt((n) => n + 1);
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.status === 429) {
        setRetryLeft(apiError.retryAfterSeconds ?? 60);
        setPhase("lockedOut");
      } else if (apiError?.status === 401) {
        setPassword("");
        setPhase("denied");
        input.current?.focus();
      } else {
        setMessage(apiError?.status === 0 ? "Cannot reach the server." : "Something went wrong.");
        setPhase("error");
      }
    }
  };

  const denied = phase === "denied";
  const granted = phase === "granted";

  return (
    <motion.div
      className="fixed inset-0 z-30 grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.12, filter: "blur(10px)" }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        key={attempt}
        animate={denied ? { x: [0, -14, 14, -10, 10, -4, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.45 }}
        className="relative w-full max-w-md"
      >
        <section
          className={`holo crt-on p-6 ${denied ? "glitch-once" : ""}`}
          data-tone={granted ? "ok" : denied || phase === "lockedOut" ? "danger" : undefined}
          aria-label="Access terminal"
        >
          <span className="bracket tl" />
          <span className="bracket tr" />
          <span className="bracket bl" />
          <span className="bracket br" />

          <h2 className="font-display glow m-0 mb-4 flex items-center gap-2 text-sm font-black tracking-[0.3em] text-neon-cyan">
            <KeyRound className="size-4" aria-hidden="true" />
            ACCESS TERMINAL
          </h2>

          <TypeLines lines={BOOT} className="mb-6 text-xs leading-relaxed text-text-muted" />

          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {/* Lets password managers pair the key with this site. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="admin"
              readOnly
              hidden
            />
            <div>
              <label
                htmlFor="access-key"
                className="mb-1 block text-xs tracking-widest text-text-muted uppercase"
              >
                Access key
              </label>
              <input
                id="access-key"
                ref={input}
                className="neon-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={phase === "pending" || granted}
                aria-invalid={denied}
                aria-describedby="access-status"
              />
            </div>

            <button
              type="submit"
              className="neon-btn flex items-center justify-center gap-2"
              disabled={!password || phase === "pending" || phase === "lockedOut" || granted}
            >
              {phase === "pending" ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  AUTHENTICATING…
                </>
              ) : (
                "Authenticate"
              )}
            </button>

            <p
              id="access-status"
              role="status"
              className="font-display m-0 flex min-h-6 items-center gap-2 text-xs font-bold tracking-[0.22em]"
            >
              {granted && (
                <span className="glow flex items-center gap-2 text-ok">
                  <ShieldCheck className="size-4" aria-hidden="true" /> ACCESS GRANTED
                </span>
              )}
              {denied && (
                <span className="glow flex items-center gap-2 text-danger">
                  <ShieldX className="size-4" aria-hidden="true" /> ACCESS DENIED
                </span>
              )}
              {phase === "lockedOut" && (
                <span className="glow flex items-center gap-2 text-danger">
                  <ShieldX className="size-4" aria-hidden="true" /> LOCKED OUT · RETRY IN{" "}
                  {retryLeft}s
                </span>
              )}
              {phase === "error" && <span className="text-warn">{message}</span>}
            </p>
          </form>

          {granted && isFull && <Burst color="var(--color-ok)" />}
        </section>
      </motion.div>
    </motion.div>
  );
}
