import { describe, expect, test } from "bun:test";

import { getCalDavEventsForIntegration } from "./integrations.route";

describe("CalDAV integration events", () => {
  test("uses the integration wrapper and persists local data through the authenticated session", async () => {
    const environment = { CALDAV_URL: "https://calendar.example/dav" };
    const localData = { calendarUrl: "/calendar/" };
    const updatedLocalData = { ...localData, syncToken: "next-token" };
    const updates: Array<{ id: string; body: unknown }> = [];
    const pb = {
      collection(name: string) {
        expect(name).toBe("integrations");
        return {
          async update(id: string, body: unknown) {
            updates.push({ id, body });
          },
        };
      },
    };
    const eventCalls: unknown[][] = [];
    const getEvents = async (...args: any[]) => {
      eventCalls.push(args);
      await args[2](updatedLocalData);
      return [{ id: "event-1" }];
    };

    const events = await getCalDavEventsForIntegration(
      { integration: { environment, localData } },
      "owned-integration-id",
      pb,
      getEvents as any,
    );

    expect(eventCalls[0]?.[0]).toBe(environment);
    expect(eventCalls[0]?.[1]).toBe(localData);
    expect(events).toEqual([{ id: "event-1" }]);
    expect(updates).toEqual([{
      id: "owned-integration-id",
      body: { localData: updatedLocalData },
    }]);
  });
});
