import { motion } from "motion/react";

type Props = { color: string; count?: number };

const GOLDEN_ANGLE = 2.399963;

/** Particles of light flying outward from the center (the lock panel dissolving). */
export function Burst({ color, count = 28 }: Props) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 grid place-items-center"
    >
      {Array.from({ length: count }, (_, i) => {
        // Deterministic scatter (golden angle) so rendering stays pure.
        const angle = i * GOLDEN_ANGLE;
        const distance = 90 + ((i * 53) % 160);
        return (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              width: 2 + ((i * 7) % 4),
              height: 2 + ((i * 7) % 4),
              background: color,
              boxShadow: `0 0 8px ${color}`,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * distance,
              y: Math.sin(angle) * distance,
              opacity: 0,
              scale: 0.2,
            }}
            transition={{ duration: 0.9, delay: ((i * 13) % 12) / 100, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}
