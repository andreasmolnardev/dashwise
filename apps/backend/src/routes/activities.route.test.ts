import { describe, expect, test } from "bun:test";
import activitiesRoute from "./activities.route";

describe("activity API authentication", () => {
  test("requires authentication for list, detail, delete, and producer routes", async () => {
    const requests = [
      new Request("http://localhost/api/v1/activities"),
      new Request("http://localhost/api/v1/activities/activity-1"),
      new Request("http://localhost/api/v1/activities/activity-1", { method: "DELETE" }),
      new Request("http://localhost/api/v1/integrations/integration-1/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "service.offline", title: "Service offline" }),
      }),
    ];

    for (const request of requests) {
      const response = await activitiesRoute.fetch(request);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
    }
  });
});
