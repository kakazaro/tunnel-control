type Props = { level: 0 | 1 | 2 | 3 | 4; label: string };

/** Four rising bars. Bars above `level` are dim. The label is the accessible name. */
export function SignalBars({ level, label }: Props) {
  return (
    <span role="img" aria-label={label} className="inline-flex h-4 items-end gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={`${i}-${level}`}
          className="bar w-1 rounded-[1px] bg-current"
          style={{
            height: `${40 + i * 20}%`,
            opacity: i < level ? 1 : 0.2,
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </span>
  );
}
