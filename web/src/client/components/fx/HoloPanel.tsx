import { useRef, type ReactNode, type PointerEvent } from "react";
import { motion, type Variants } from "motion/react";
import { useEffectsLevel } from "../../hooks/useEffectsLevel";

/** Shared by every panel so the Deck can power them up (and down) in a stagger. */
export const panelVariants: Variants = {
  dormant: { opacity: 0.35, y: 10, scale: 0.985, filter: "blur(3px) saturate(0.5)" },
  live: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px) saturate(1)",
    transition: { type: "spring", stiffness: 160, damping: 20 },
  },
};

type Props = {
  title: string;
  icon?: ReactNode;
  tone?: "ok" | "danger";
  stale?: boolean;
  className?: string;
  children: ReactNode;
  /** Right-aligned header slot (badges, counters). */
  aside?: ReactNode;
};

const MAX_TILT_DEG = 4;

export function HoloPanel({ title, icon, tone, stale, className = "", children, aside }: Props) {
  const ref = useRef<HTMLElement>(null);
  const { isFull } = useEffectsLevel();

  const onMove = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || !isFull || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    // Subtle 3D tilt toward the pointer (desktop pointers only).
    el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * MAX_TILT_DEG}deg) rotateY(${(x - 0.5) * MAX_TILT_DEG}deg)`;
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <motion.section
      ref={ref}
      variants={panelVariants}
      className={`holo ${stale ? "stale" : ""} flex min-h-0 flex-col p-4 ${className}`}
      data-tone={tone}
      aria-label={title}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <span className="bracket tl" />
      <span className="bracket tr" />
      <span className="bracket bl" />
      <span className="bracket br" />
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display flex items-center gap-2 text-xs font-bold tracking-[0.22em] text-neon-cyan uppercase">
          {icon}
          {title}
        </h2>
        {aside}
      </header>
      <div className="relative -m-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1">
        {children}
      </div>
    </motion.section>
  );
}
