import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type FxLevel = "full" | "reduced";

const STORAGE_KEY = "tc.fx";
const QUERY = "(prefers-reduced-motion: reduce)";

function readPref(): FxLevel | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "full" || v === "reduced" ? v : null;
  } catch {
    return null;
  }
}

function systemReduced(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

type Ctx = {
  /** Effective level: reduced if the OS asks for it or the user chose it. */
  level: FxLevel;
  isFull: boolean;
  /** True when the OS forces reduced motion (the toggle is then locked). */
  systemForced: boolean;
  toggle: () => void;
};

const FxContext = createContext<Ctx>({
  level: "reduced",
  isFull: false,
  systemForced: false,
  toggle: () => {},
});

export function EffectsProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<FxLevel | null>(readPref);
  const [system, setSystem] = useState<boolean>(systemReduced);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setSystem(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const level: FxLevel = system || pref === "reduced" ? "reduced" : "full";

  useEffect(() => {
    document.documentElement.dataset.fx = level;
  }, [level]);

  // Pause ambient loops while the tab is hidden.
  useEffect(() => {
    const update = () => {
      document.documentElement.dataset.hidden = String(document.hidden);
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const toggle = useCallback(() => {
    const next: FxLevel = level === "full" ? "reduced" : "full";
    setPref(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the choice just will not persist */
    }
  }, [level]);

  const value = useMemo<Ctx>(
    () => ({ level, isFull: level === "full", systemForced: system, toggle }),
    [level, system, toggle],
  );
  return <FxContext.Provider value={value}>{children}</FxContext.Provider>;
}

export function useEffectsLevel(): Ctx {
  return useContext(FxContext);
}
