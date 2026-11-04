import { useMemo } from "react";
import { useResourceView } from "@/hooks/useResourceView";
import type { ViewResourceQuery } from "@/lib/viewsApi";

export type CalendarEventView = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  isAllDay: boolean;
  integrationId?: string;
};

/** Calendar consumers query the shared resource layer instead of the activity snapshot. */
export function useCalendarEvents(enabled = true) {
  const query = useMemo<ViewResourceQuery>(() => ({
    types: ["calendar.event"],
    provider: "caldav",
    providerInstanceId: "",
    capabilities: ["list"],
    filters: [],
    search: "",
    sort: [{ field: "startAt", direction: "asc" }],
    limit: 200,
    offset: 0,
  }), []);
  const resourceView = useResourceView(query, enabled);
  const events = useMemo<CalendarEventView[]>(() => (resourceView.data?.items ?? []).flatMap((resource) => {
    const start = resource.data.startAt;
    const end = resource.data.endAt;
    if (typeof start !== "string" || typeof end !== "string") return [];
    return [{
      id: resource.id,
      title: typeof resource.data.title === "string" ? resource.data.title : "",
      start,
      end,
      location: typeof resource.data.location === "string" ? resource.data.location : undefined,
      isAllDay: resource.data.isAllDay === true,
      integrationId: resource.providerInstanceId,
    }];
  }), [resourceView.data]);
  return { ...resourceView, events };
}
