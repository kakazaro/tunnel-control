import { useEffect, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRightLeft,
  Link2,
  Play,
  ScrollText,
  Square,
  Timer,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { EventType, TunnelEvent } from "../../shared/schemas";
import { useEffectsLevel } from "../hooks/useEffectsLevel";
import { clockTime } from "../lib/format";
import { AnimatedNumber } from "./fx/AnimatedNumber";
import { HoloPanel } from "./fx/HoloPanel";

type Props = { events: TunnelEvent[] | undefined; stale: boolean };

const META: Record<
  EventType,
  { Icon: ComponentType<{ className?: string }>; color: string; tag: string }
> = {
  desired_changed: { Icon: ArrowRightLeft, color: "text-neon-magenta", tag: "COMMAND" },
  tunnel_started: { Icon: Play, color: "text-ok", tag: "STARTED" },
  tunnel_stopped: { Icon: Square, color: "text-warn", tag: "STOPPED" },
  url_changed: { Icon: Link2, color: "text-neon-cyan", tag: "NEW URL" },
  agent_error: { Icon: TriangleAlert, color: "text-danger", tag: "ERROR" },
  agent_online: { Icon: Wifi, color: "text-ok", tag: "ONLINE" },
  agent_offline_detected: { Icon: WifiOff, color: "text-danger", tag: "OFFLINE" },
  session_expired: { Icon: Timer, color: "text-warn", tag: "SESSION END" },
};

/** Types its text out once, when the row is first shown live. */
function Typed({ text, animate }: { text: string; animate: boolean }) {
  const { isFull } = useEffectsLevel();
  const enabled = animate && isFull;
  const [n, setN] = useState(enabled ? 0 : text.length);

  useEffect(() => {
    if (!enabled || n >= text.length) return;
    const id = window.setTimeout(() => setN((v) => v + 1), 18);
    return () => window.clearTimeout(id);
  }, [enabled, n, text.length]);

  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{text.slice(0, n)}</span>
    </>
  );
}

function Row({ event, isNew }: { event: TunnelEvent; isNew: boolean }) {
  const { Icon, color, tag } = META[event.type];
  // Decided once at mount: later re-renders must not restart the typing.
  const [fresh] = useState(isNew);
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -16, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className={`flex gap-3 border-b border-line/50 py-2 text-sm last:border-0 ${fresh ? "shadow-[inset_2px_0_0_var(--color-neon-cyan)]" : ""}`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <p className="m-0 flex flex-wrap items-baseline gap-x-2">
          <span className={`font-display text-[0.65rem] font-bold tracking-widest ${color}`}>
            {tag}
          </span>
          <time
            className="text-xs text-text-muted tabular-nums"
            dateTime={new Date(event.at).toISOString()}
          >
            {clockTime(event.at)}
          </time>
        </p>
        <p className="m-0 break-words text-text">
          <Typed text={event.message} animate={fresh} />
        </p>
      </div>
    </motion.li>
  );
}

export function EventList({ events, stale }: Props) {
  // Rows that arrive after the first load animate in; the first batch does not.
  const [known, setKnown] = useState<Set<number> | null>(null);
  useEffect(() => {
    if (!events) return;
    // Deferred so that this render still sees the previous set (and marks rows as new).
    const id = window.setTimeout(() => setKnown(new Set(events.map((e) => e.id))), 0);
    return () => window.clearTimeout(id);
  }, [events]);

  return (
    <HoloPanel
      title="Event stream"
      icon={<ScrollText className="size-4" aria-hidden="true" />}
      stale={stale}
      className="min-h-64 md:min-h-0"
      aside={
        <span className="text-xs text-text-muted">
          <AnimatedNumber value={events?.length ?? 0} durationMs={700} /> LOGGED
        </span>
      }
    >
      <div
        className="h-full overflow-y-auto pr-1"
        tabIndex={0}
        role="region"
        aria-label="Recent events"
      >
        {events && events.length > 0 ? (
          <ul className="m-0 list-none p-0" aria-live="polite">
            <AnimatePresence initial={false}>
              {events.map((e) => (
                <Row key={e.id} event={e} isNew={known !== null && !known.has(e.id)} />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="m-0 text-sm text-text-muted">
            {events ? "No events yet." : "— NO SIGNAL —"}
          </p>
        )}
      </div>
    </HoloPanel>
  );
}
