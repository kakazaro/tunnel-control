import { useEffect, useRef, useState } from "react";

/**
 * A ticking "now" in SERVER time. The browser clock may be off, so we keep the
 * offset between the server's `serverTime` and the local clock.
 */
export function useServerNow(serverTime: number | undefined, intervalMs = 1000): number {
  const skew = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (serverTime === undefined) return;
    skew.current = serverTime - Date.now();
    const id = requestAnimationFrame(() => setNow(Date.now() + skew.current));
    return () => cancelAnimationFrame(id);
  }, [serverTime]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now() + skew.current);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
