import { useEffect, useState } from "react";
import { useEffectsLevel } from "../../hooks/useEffectsLevel";

type Props = {
  lines: string[];
  charMs?: number;
  className?: string;
  onDone?: () => void;
};

/** Types the lines one after another with a blinking cursor on the active line. */
export function TypeLines({ lines, charMs = 22, className, onDone }: Props) {
  const { isFull } = useEffectsLevel();
  const total = lines.reduce((n, l) => n + l.length, 0);
  const [typed, setTyped] = useState(0);
  const shown = isFull ? typed : total;

  useEffect(() => {
    if (!isFull) {
      onDone?.();
      return;
    }
    if (typed >= total) {
      onDone?.();
      return;
    }
    const id = window.setTimeout(() => setTyped((n) => n + 1), charMs);
    return () => window.clearTimeout(id);
  }, [typed, total, charMs, isFull, onDone]);

  const starts = lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + l.length, 0));
  return (
    <div className={className}>
      <span className="sr-only">{lines.join(". ")}</span>
      {lines.map((line, i) => {
        const part = line.slice(0, Math.max(0, shown - starts[i]!));
        const active = isFull && part.length > 0 && part.length < line.length;
        return (
          <div key={i} aria-hidden="true" className={active ? "cursor" : ""}>
            {part || "�"}
          </div>
        );
      })}
    </div>
  );
}
