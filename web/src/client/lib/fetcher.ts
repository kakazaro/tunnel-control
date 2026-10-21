import { http } from "./http";

export const fetcher = <T>(url: string): Promise<T> => http.get<T>(url).then((r) => r.data);
