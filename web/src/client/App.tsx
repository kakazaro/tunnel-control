import { useCallback, useState } from "react";
import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import { useLogout } from "./hooks/useAuth";
import { useControl } from "./hooks/useControl";
import { useEffectsLevel } from "./hooks/useEffectsLevel";
import { useEvents } from "./hooks/useEvents";
import { useServerNow } from "./hooks/useServerNow";
import { useSetDesired } from "./hooks/useSetDesired";
import { unlockSession, useSessionLocked } from "./lib/session";
import { ErrorBanner } from "./components/ErrorBanner";
import { EventList } from "./components/EventList";
import { Header } from "./components/Header";
import { LockPanel } from "./components/LockPanel";
import { SessionModal } from "./components/SessionModal";
import { ReactorButton } from "./components/ReactorButton";
import { StatusCard } from "./components/StatusCard";
import { TunnelCard } from "./components/TunnelCard";
import { Stage } from "./components/fx/Stage";
import { panelVariants } from "./components/fx/HoloPanel";

/** Powers panels up one after another, and down in reverse. */
const deckVariants: Variants = {
  dormant: { transition: { staggerChildren: 0.06, staggerDirection: -1 } },
  live: { transition: { staggerChildren: 0.14, delayChildren: 0.2 } },
};

/** A bright horizontal scan line that sweeps down the screen when the deck unlocks. */
function ScanWipe({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-40 h-32 bg-gradient-to-b from-transparent via-neon-cyan/40 to-transparent"
      initial={{ y: "-20vh", opacity: 1 }}
      animate={{ y: "110vh", opacity: 0.9 }}
      transition={{ duration: 0.9, ease: "easeIn" }}
      onAnimationComplete={onDone}
    />
  );
}

export default function App() {
  const { isFull } = useEffectsLevel();
  const locked = useSessionLocked();
  const control = useControl();
  const { setDesired, isMutating, error: setError } = useSetDesired();
  const { logout } = useLogout();
  const [wipe, setWipe] = useState(0);
  const [choosingSession, setChoosingSession] = useState(false);

  const data = control.data;
  const now = useServerNow(data?.serverTime);
  const live = !locked && data !== undefined;
  const events = useEvents(live);
  const stale = Boolean(control.error && control.error.status !== 401 && data);

  const onGranted = useCallback(() => {
    unlockSession();
    setWipe((n) => n + 1);
  }, []);

  const alert =
    (control.error && control.error.status !== 401 ? control.error.message : null) ??
    setError?.message ??
    data?.status?.lastError ??
    null;

  return (
    <MotionConfig reducedMotion={isFull ? "user" : "always"}>
      <Stage />
      <div className="relative z-10 flex min-h-dvh flex-col md:h-dvh md:overflow-hidden">
        <Header unlocked={live} syncing={control.isValidating} onLogout={() => void logout()} />
        <ErrorBanner message={alert} />

        <motion.main
          variants={deckVariants}
          initial="dormant"
          animate={live ? "live" : "dormant"}
          inert={!live}
          aria-hidden={!live}
          className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-2 md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-1"
        >
          <div className="flex min-h-0 flex-col gap-4 md:row-span-2 lg:row-span-1">
            <StatusCard data={data} now={now} stale={stale} />
            <div className="flex min-h-0 flex-col">
              <TunnelCard data={data} now={now} stale={stale} />
            </div>
          </div>

          <motion.div
            variants={panelVariants}
            className="order-first flex flex-col items-center justify-center py-6 md:order-none"
          >
            <ReactorButton
              desired={data?.desired ?? "stopped"}
              online={data?.online ?? false}
              pending={data?.pending ?? false}
              busy={isMutating}
              disabled={!live}
              onToggle={(next) => {
                // Starting needs a session length first; stopping is immediate.
                if (next === "running") setChoosingSession(true);
                else void setDesired("stopped").catch(() => undefined);
              }}
            />
          </motion.div>

          <EventList events={events.data?.events} stale={stale} />
        </motion.main>

        <AnimatePresence>
          {locked && <LockPanel key="lock" onGranted={onGranted} />}
        </AnimatePresence>
        <AnimatePresence>
          {choosingSession && live && (
            <SessionModal
              key="session"
              onCancel={() => setChoosingSession(false)}
              onConfirm={(hours) => {
                setChoosingSession(false);
                void setDesired("running", hours).catch(() => undefined);
              }}
            />
          )}
        </AnimatePresence>
        {wipe > 0 && isFull && <ScanWipe key={wipe} onDone={() => setWipe(0)} />}
      </div>
    </MotionConfig>
  );
}
