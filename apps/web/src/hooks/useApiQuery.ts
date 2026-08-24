import { useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";
import type { ActionAuth } from "@dashwise/types/sdk";

type AuthenticatedQueryOptions<TData> = Omit<
  UseQueryOptions<TData, Error, TData, QueryKey>,
  "queryKey" | "queryFn" | "enabled"
> & {
  enabled?: boolean;
};

/**
 * The standard read path for authenticated API endpoints. The session token is
 * included in the cache key to prevent data from a previous session appearing
 * during a user switch.
 */
export function useApiQuery<TData>(
  key: readonly unknown[],
  queryFn: (auth: ActionAuth) => Promise<TData>,
  options?: AuthenticatedQueryOptions<TData>,
) {
  const { token } = useAuth();

  return useQuery({
    ...options,
    queryKey: ["api", token, ...key],
    enabled: Boolean(token) && (options?.enabled ?? true),
    queryFn: () => queryFn({ token }),
  });
}
