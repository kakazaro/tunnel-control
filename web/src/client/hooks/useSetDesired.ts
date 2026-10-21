import { useCallback } from "react";
import { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import type { ControlResponse, SessionHours, SetDesiredBody } from "../../shared/schemas";
import { http, type ApiError } from "../lib/http";
import { CONTROL_KEY } from "./useControl";
import { EVENTS_KEY } from "./useEvents";

/** PUT /control with an optimistic update of `desired`, then the server's answer. */
export function useSetDesired() {
  const { mutate } = useSWRConfig();
  const { trigger, isMutating, error } = useSWRMutation<
    ControlResponse,
    ApiError,
    string,
    SetDesiredBody
  >(CONTROL_KEY, (url, { arg }) => http.put<ControlResponse>(url, arg).then((r) => r.data));

  /** Starting needs a session length; stopping takes none. */
  const setDesired = useCallback(
    async (next: "running" | "stopped", durationHours?: SessionHours) => {
      const body: SetDesiredBody =
        next === "running" && durationHours !== undefined
          ? { state: "running", durationHours }
          : { state: "stopped" };
      await trigger(body, {
        optimisticData: (current?: ControlResponse) =>
          current
            ? {
                ...current,
                desired: body.state,
                expiresAt:
                  body.state === "running" ? Date.now() + body.durationHours * 3_600_000 : null,
                pending:
                  current.online &&
                  (body.state === "running") !== (current.status?.running ?? false),
              }
            : (current as unknown as ControlResponse),
        populateCache: true,
        rollbackOnError: true,
        revalidate: false,
      });
      void mutate(EVENTS_KEY);
    },
    [trigger, mutate],
  );

  return { setDesired, isMutating, error };
}
