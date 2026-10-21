import { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { http, type ApiError } from "../lib/http";
import { lockSession } from "../lib/session";

export function useLogin() {
  return useSWRMutation<{ ok: true }, ApiError, string, string>("/auth/login", (url, { arg }) =>
    http.post<{ ok: true }>(url, { password: arg }).then((r) => r.data),
  );
}

export function useLogout() {
  const { mutate } = useSWRConfig();
  const mutation = useSWRMutation<{ ok: true }, ApiError, string>("/auth/logout", (url) =>
    http.post<{ ok: true }>(url).then((r) => r.data),
  );
  const logout = async () => {
    try {
      await mutation.trigger();
    } finally {
      lockSession();
      // Forget everything fetched while signed in.
      await mutate(() => true, undefined, { revalidate: false });
    }
  };
  return { logout, isLoggingOut: mutation.isMutating };
}
