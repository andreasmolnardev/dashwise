import { describe, expect, test } from "bun:test";
import { ActivityPublishError, createActivityPublisher, validatePublishActivityInput } from "./activities";

const validInput = {
  type: "service.offline",
  title: "Nextcloud is offline",
  severity: "warning" as const,
  metadata: { serviceId: "nextcloud" },
};

describe("activity publishing SDK", () => {
  test("validates a payload and rejects ownership/source fields", () => {
    expect(validatePublishActivityInput(validInput)).toEqual(validInput);
    expect(() => validatePublishActivityInput({ ...validInput, ownerId: "another-user" })).toThrow(ActivityPublishError);
    expect(() => validatePublishActivityInput({ ...validInput, source: "spoofed-source" })).toThrow(ActivityPublishError);
  });

  test("rejects unsafe actions, credential metadata, and oversized metadata", () => {
    expect(() => validatePublishActivityInput({ ...validInput, action: { label: "Open", target: "https://evil.example" } })).toThrow(/safe internal path/);
    expect(() => validatePublishActivityInput({ ...validInput, metadata: { apiKey: "do-not-store" } })).toThrow(/credentials or secrets/);
    expect(() => validatePublishActivityInput({ ...validInput, metadata: { payload: "x".repeat(17 * 1024) } })).toThrow(/16 KB limit/);
  });

  test("posts with the authenticated integration route and returns the server result", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const result = {
      activity: { id: "activity-1", ownerId: "user-1" },
      duplicate: false,
    };
    const publisher = createActivityPublisher({
      baseUrl: "https://dashwise.example.com/api/v1/",
      integrationId: "integration / 1",
      token: async () => "session-token",
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Response.json(result, { status: 201 });
      },
    });

    await expect(publisher.publish(validInput)).resolves.toEqual(result);
    expect(requestedUrl).toBe("https://dashwise.example.com/api/v1/integrations/integration%20%2F%201/activities");
    expect(requestedInit?.method).toBe("POST");
    expect(new Headers(requestedInit?.headers).get("authorization")).toBe("Bearer session-token");
    expect(JSON.parse(String(requestedInit?.body))).toEqual(validInput);
  });

  test("surfaces API status and response errors", async () => {
    const publisher = createActivityPublisher({
      baseUrl: "https://dashwise.example.com",
      integrationId: "integration-1",
      token: "session-token",
      fetch: async () => Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    await expect(publisher.publish(validInput)).rejects.toMatchObject({
      name: "ActivityPublishError",
      message: "Unauthorized",
      status: 401,
      responseBody: { error: "Unauthorized" },
    });
  });
});
