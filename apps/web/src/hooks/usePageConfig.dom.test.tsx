import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import React, { act } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import { Window } from "happy-dom";
import { createQueryClient } from "../lib/queryClient";

let token: string | null = "session-a";
const requests: string[] = [];
mock.module("../context/useAuth", () => ({ default: () => ({ token, user: {} }) }));
mock.module("../lib/apiClient", () => ({ getPageConfigAction: async (_auth: unknown, page: string) => {
  requests.push(`${token}:${page}`);
  return page === "missing" ? null : { pages: [page], marker: `${token}:${page}` };
} }));
mock.module("../components/dashboard/DashboardLayoutTemplate", () => ({
  default: ({ config, isLoading }: { config: { marker?: string } | null; isLoading: boolean }) =>
    <div>{isLoading ? "loading" : config?.marker}</div>,
}));
mock.module("../components/errorPages/PageNotFound", () => ({ default: () => <div>not found</div> }));

let dom: Window;
let createRoot: typeof import("react-dom/client").createRoot;
let DashboardPage: typeof import("../app/(authenticated)/dashboard/[page]/page").default;
let usePageConfig: typeof import("./usePageConfig").usePageConfig;
let LocalizationProvider: typeof import("../context/LocalizationContext").LocalizationProvider;
let navigate: NavigateFunction;
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

beforeAll(async () => {
  dom = new Window({ url: "http://localhost" });
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, Event: dom.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ default: DashboardPage } = await import("../app/(authenticated)/dashboard/[page]/page"));
  ({ usePageConfig } = await import("./usePageConfig"));
  ({ LocalizationProvider } = await import("../context/LocalizationContext"));
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

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
function SharedConsumer() {
  const { config } = usePageConfig();
  navigate = useNavigate();
  return <span>{config?.pages?.join(",")}</span>;
}

it("shares requests, reuses cached pages, isolates sessions, and handles missing pages", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const client = createQueryClient();
  const render = () => <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={["/home"]}>
      <LocalizationProvider>
        <SharedConsumer />
        <Routes><Route path="/:page" element={<DashboardPage />} /></Routes>
      </LocalizationProvider>
    </MemoryRouter>
  </QueryClientProvider>;
  try {
    await act(async () => root.render(render()));
    await settle();
    expect(requests).toEqual(["session-a:home"]);
    expect(container.textContent).toContain("session-a:home");
    await act(async () => { navigate("/work"); });
    await settle();
    expect(requests).toEqual(["session-a:home", "session-a:work"]);
    expect(container.textContent).toContain("session-a:work");
    await act(async () => { navigate("/home"); });
    await settle();
    expect(requests.length).toBe(2);
    expect(container.textContent).toContain("session-a:home");
    await act(async () => { window.dispatchEvent(new Event("config:updated")); });
    await settle();
    expect(requests.length).toBe(3);
    token = "session-b";
    await act(async () => root.render(render()));
    expect(container.textContent).not.toContain("session-a:home");
    await settle();
    expect(requests.at(-1)).toBe("session-b:home");
    await act(async () => { navigate("/missing"); });
    await settle();
    expect(container.textContent).toContain("not found");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    token = "session-a";
  }
});

it("localization alone does not fetch page configuration", async () => {
  const root = createRoot(document.createElement("div"));
  const client = createQueryClient();
  const before = requests.length;
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/apps/news"]}>
          <LocalizationProvider><div>News</div></LocalizationProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ));
    await settle();
    expect(requests.length).toBe(before);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
