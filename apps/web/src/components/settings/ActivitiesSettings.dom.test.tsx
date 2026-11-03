import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import React, { act } from "react";
import { Window } from "happy-dom";

const definitions = [
  { id: "calendar", title: "Upcoming events", source: "builtin", enabled: true, configFields: [{ key: "windowMinutes", label: "Upcoming window", type: "number" }] },
  { id: "sunrise", title: "Sunrise and sunset", source: "builtin", enabled: false },
  { id: "ha-low-battery", title: "Low battery sensor", source: "user", enabled: false },
];
const withAuth = (callback: (auth: { token: string }) => unknown) => callback({ token: "session-token" });
const fetchCalls: Array<{ path: string; method: string; body?: string }> = [];
mock.module("../../context/useAuth", () => ({ default: () => ({ token: "session-token", withAuth }) }));
mock.module("../../lib/apiClient", () => ({
  authHeaders: () => ({ Authorization: "Bearer session-token" }),
  backendUrl: (path: string) => path,
}));

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
let createRoot: typeof import("react-dom/client").createRoot;
let ActivitiesSettings: typeof import("./ActivitiesSettings").default;

beforeAll(async () => {
  dom = new Window({ url: "http://localhost" });
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  originalGlobals.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    fetchCalls.push({ path, method, body: typeof init?.body === "string" ? init.body : undefined });
    const body = method === "POST"
      ? { definition: { id: "resource-condition-1", title: JSON.parse(String(init?.body)).title, source: "user", enabled: true } }
      : {
        definitions,
        resourceCatalog: [{ instanceId: "ha-1", instanceName: "Home Assistant", collectionId: "entities", resourceId: "sensor.battery", name: "Battery sensor", fields: ["state", "attributes.battery_level"] }],
      };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  ({ createRoot } = await import("react-dom/client"));
  ({ default: ActivitiesSettings } = await import("./ActivitiesSettings"));
});

it("creates a resource condition using the selected catalog fields", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ActivitiesSettings />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const setValue = async (selector: string, value: string, eventType = "input") => {
      await act(async () => {
        const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, value);
        element.dispatchEvent(new dom.Event(eventType, { bubbles: true }) as unknown as Event);
      });
    };
    await setValue("#resource-condition-title", "Battery low");
    const collection = container.querySelector<HTMLSelectElement>("#resource-condition-collection")!;
    await setValue("#resource-condition-collection", collection.options[1].value, "change");
    await setValue("#resource-condition-field", "attributes.battery_level", "change");
    await setValue("#resource-condition-operator", "lessThan", "change");
    await setValue("#resource-condition-value", "20");
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const post = fetchCalls.find((call) => call.method === "POST");
    expect(post?.path).toBe("/api/v1/activities/definitions/resource-conditions");
    expect(JSON.parse(post?.body ?? "{}")).toMatchObject({
      title: "Battery low",
      instanceId: "ha-1",
      collectionId: "entities",
      fieldPath: "attributes.battery_level",
      operator: "lessThan",
      value: 20,
    });
    expect(container.textContent).toContain("Battery low");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

afterAll(async () => {
  await dom.happyDOM.abort();
  dom.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  mock.restore();
});

it("lists inactive definitions and exposes their settings controls", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ActivitiesSettings />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(container.textContent).toContain("Upcoming events");
    expect(container.textContent).toContain("Sunrise and sunset");
    expect(container.textContent).toContain("Low battery sensor");
    expect(container.textContent).toContain("Upcoming window");
    expect(container.textContent).toContain("Add a resource condition");
    expect(container.textContent).toContain("Home Assistant · entities");
    await act(async () => {
      const collection = container.querySelector<HTMLSelectElement>("#resource-condition-collection")!;
      collection.value = collection.options[1].value;
      collection.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
    });
    expect(container.querySelector("#resource-condition-field")?.textContent).toContain("attributes.battery_level");
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
