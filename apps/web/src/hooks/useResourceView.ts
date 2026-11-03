import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import { queryResourcesAction, type ViewResourceQuery } from "@/lib/viewsApi";

/** A resource query is an ephemeral view, suitable for a widget or frame. */
export function useResourceView(query: ViewResourceQuery, enabled = true) {
  return useApiQuery(
    queryKeys.resources.query(query),
    (auth) => queryResourcesAction(auth, query),
    { enabled },
  );
}
