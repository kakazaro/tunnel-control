import { useEffect, useRef, useState } from "react";
import { useEffectsLevel } from "../../hooks/useEffectsLevel";

const GLYPHS = "█▓▒░<>/\\|_#@$%&*+=-";

type Props = { text: string; durationMs?: number; className?: string };

/** "Decrypts" into `text` whenever it changes. Screen readers get the real text. */
export function ScrambleText({ text, durationMs = 600, className }: Props) {
  const { isFull } = useEffectsLevel();
  const [display, setDisplay] = useState(text);
  const raf = useRef(0);

  useEffect(() => {
    if (!isFull) {
      raf.current = requestAnimationFrame(() => setDisplay(text));
      return () => cancelAnimationFrame(raf.current);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const settled = Math.floor(progress * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        out +=
          i < settled || ch === " " || ch === "." || ch === ":" || ch === "/"
            ? ch
            : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setDisplay(out);
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [text, durationMs, isFull]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{display}</span>
    </span>
  );
}
