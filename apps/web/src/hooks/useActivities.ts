import type { ActivityQuery } from "@dashwise/types";
import { useApiQuery } from "@/hooks/useApiQuery";
import { getActivityAction, getActivityPageAction } from "@/lib/apiClient";
import { queryKeys } from "@/lib/queryClient";

export function useActivityPage(query: ActivityQuery = {}) {
  return useApiQuery(queryKeys.activities.list(query), (auth) => getActivityPageAction(auth, query));
}

export function useActivityDetail(activityId: string) {
  return useApiQuery(queryKeys.activities.detail(activityId), (auth) => getActivityAction(auth, activityId), {
    enabled: Boolean(activityId),
  });
}
