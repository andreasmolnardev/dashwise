import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";
import type { ActionAuth } from "@dashwise/types/sdk";

/** Standard mutation path for authenticated API endpoints. */
export function useApiMutation<TData, TVariables>(
  mutationFn: (auth: ActionAuth, variables: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, "mutationFn">,
) {
  const { token } = useAuth();

  return useMutation({
    ...options,
    mutationFn: (variables) => {
      if (!token) throw new Error("Unauthorized");
      return mutationFn({ token }, variables);
    },
  });
}
