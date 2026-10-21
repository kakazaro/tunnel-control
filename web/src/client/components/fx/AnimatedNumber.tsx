import { useEffect, useRef, useState } from "react";
import { useEffectsLevel } from "../../hooks/useEffectsLevel";

type Props = {
  value: number;
  durationMs?: number;
  format?: (n: number) => string;
  className?: string;
};

/** Counts up from 0 to `value` on first show, then eases to later values. */
export function AnimatedNumber({ value, durationMs = 900, format = String, className }: Props) {
  const { isFull } = useEffectsLevel();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!isFull) {
      raf.current = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(raf.current);
    }
    const start = performance.now();
    const origin = from.current;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(origin + (value - origin) * eased);
      from.current = next;
      setShown(next);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, durationMs, isFull]);

  return <span className={`tabular-nums ${className ?? ""}`}>{format(shown)}</span>;
}
