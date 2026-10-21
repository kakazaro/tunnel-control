import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { unlockSession } from "../../src/client/lib/session";

// jsdom has no matchMedia; the effects hook and motion both ask for it.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  // Reduced effects: no typing/scramble/burst delays, so tests stay fast and deterministic.
  localStorage.setItem("tc.fx", "reduced");
  unlockSession();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
