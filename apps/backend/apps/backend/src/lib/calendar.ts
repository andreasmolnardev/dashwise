import { CalDAVClient } from "ts-caldav";

export async function getUpcomingEvents(config: any) {
  const { url: baseUrl, username, password: base64Password } = config;
  const password = Buffer.from(base64Password, "base64").toString("utf-8");

  const client = await CalDAVClient.create({
    baseUrl,
    auth: {
      type: "basic",
      username,
      password,
    }
  });

  const calendars = await client.getCalendars();
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 30);

  const allEvents = await Promise.all(
    calendars.map((cal: any) =>
      client.getEvents(cal.url, { start: start, end: end }).catch(() => [])
    )
  );

  const flatEvents = allEvents.flat();
  flatEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return flatEvents.map(event => ({
    id: event.uid,
    title: event.summary,
    description: event.description,
    start: event.start,
    end: event.end,
    lo    lo    lo    lo    lo    lo    lo    lo    lleDay
  }));
}
