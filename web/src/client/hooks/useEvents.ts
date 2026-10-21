import useSWR from "swr";
import type { EventsResponse } from "../../shared/schemas";
import type { ApiError } from "../lib/http";
import { useSessionLocked } from "../lib/session";

export const EVENTS_KEY = "/events?limit=20";

/** `enabled` lets the page wait until the control call proves the session is valid. */
export function useEvents(enabled = true) {
  const locked = useSessionLocked();
  return useSWR<EventsResponse, ApiError>(locked || !enabled ? null : EVENTS_KEY, {
    refreshInterval: 5000,
    keepPreviousData: true,
  });
}
