import { CalDAVClient } from "ts-caldav";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CachedEvents = {
  events: any[];
  cachedAt: number;
};

type CachedEventEntry = CachedEvents;

export async function getUpcomingEvents(
  environment: Record<string, string>,
  localData?: Record<string, unknown>,
  updateLocalData?: (data: Record<string, unknown>) => Promise<void>,
) {
  const baseUrl = environment.CALDAV_URL;
  const username = environment.CALDAV_USERNAME;
  const base64Password = environment.CALDAV_PASSWORD;

  if (!baseUrl || !username || !base64Password) {
    console.error("[caldav] Missing credentials:", {
      baseUrl: !!baseUrl,
      username: !!username,
      password: !!base64Password,
    });
    throw new Error(
      "CalDAV credentials not configured. Please check integration settings.",
    );
  }

  const cached = localData?.caldavCache as CachedEventEntry | undefined;
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    console.log(
      "[caldav] Using cached events, age:",
      Date.now() - cached.cachedAt,
      "ms",
    );
    return cached.events;
  }

  const password = Buffer.from(base64Password, "base64").toString("utf-8");

  console.log("[caldav] Fetching events from server...");

  try {
    const client = await CalDAVClient.create({
      baseUrl,
      auth: {
        type: "basic",
        username,
        password,
      }, //todo: allow self signed certs
    });

    const calendars = await client.getCalendars();
    console.log(`[caldav] Found ${calendars.length} calendars`);

    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 30);

    const allEvents = await Promise.all(
      calendars.map(async (cal: any) => {
        const fullUrl = new URL(cal.url, baseUrl).toString();

        console.log("[caldav] Fetching from:", fullUrl);

        try {
          const events = await client.getEvents(fullUrl, {
            start, // pass Date objects, not strings
            end,   // pass Date objects, not strings
          });

          console.log(`[caldav] Got ${events.length} events from ${cal.displayName || cal.url}`);
          return events;
        } catch (error) {
          console.error("[caldav] Failed to fetch events for calendar:", cal.displayName || cal.url, error);
          return [];
        }
      }),
    );

    const flatEvents = allEvents.flat();

    flatEvents.sort(
      (a: any, b: any) =>
        new Date(a.start).getTime() - new Date(b.start).getTime(),
    );

    const events = flatEvents.map((event: any) => ({
      id: event.uid,
      title: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      location: event.location,
      isAllDay: event.wholeDay,
    }));

    if (updateLocalData) {
      const newLocalData = {
        ...localData,
        caldavCache: { events, cachedAt: Date.now() },
      };
      await updateLocalData(newLocalData);
      console.log("[caldav] Updated cache");
    }

    return events;
  } catch (error) {
    console.error("[caldav] Failed to create CalDAV client:", error);
    throw error;
  }
}