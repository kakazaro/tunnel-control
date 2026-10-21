import useSWR from "swr";
import type { ControlResponse } from "../../shared/schemas";
import type { ApiError } from "../lib/http";
import { useSessionLocked } from "../lib/session";

export const CONTROL_KEY = "/control";

/** Polls the control state every 5s. A null key (locked) fetches nothing. */
export function useControl() {
  const locked = useSessionLocked();
  return useSWR<ControlResponse, ApiError>(locked ? null : CONTROL_KEY, {
    refreshInterval: 5000,
    keepPreviousData: true,
  });
}
