import { useState } from "react";

/**
 * Returns a number that increases each time `value` changes (but not on first render).
 * Use it as a React `key` to replay a one-shot CSS animation on change.
 */
export function useChangeKey(value: unknown): number {
  const [state, setState] = useState({ prev: value, count: 0 });
  if (state.prev !== value) {
    // Deriving state from props: React re-renders right away, before painting.
    setState({ prev: value, count: state.count + 1 });
    return state.count + 1;
  }
  return state.count;
}
