import { useSyncExternalStore } from "react";

/**
 * Tiny store: is the page locked (no valid session)?
 * The Axios interceptor locks it on any 401 outside /auth/*, and logout locks it too.
 */
let locked = false;
const listeners = new Set<() => void>();

function emit(next: boolean): void {
  if (locked === next) return;
  locked = next;
  listeners.forEach((l) => l());
}

export const lockSession = (): void => emit(true);
export const unlockSession = (): void => emit(false);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useSessionLocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => locked,
    () => false,
  );
}
