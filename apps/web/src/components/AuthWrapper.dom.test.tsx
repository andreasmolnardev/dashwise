import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import React, { act, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Window } from "happy-dom";

let token: string | null = "session-token";
const user = { appearancePreferences: { themeMode: "dark" } };
const setAuth = mock(() => {});
const logout = mock(() => {});
const passthrough = ({ children }: { children: ReactNode }) => children;

mock.module("../context/useAuth", () => ({ default: () => ({ token, user, setAuth, logout }) }));
mock.module("../lib/apiClient", () => ({
  validateAuthTokenAction: async () => ({ user, token }),
  fetchWallpaperBlob: async () => new Blob(),
}));
mock.module("../context/LocalizationContext", () => ({ LocalizationProvider: passthrough }));
mock.module("../context/NotificationContext", () => ({ NotificationProvider: passthrough }));
mock.module("../context/MediaPlayerContext", () => ({ MediaPlayerProvider: passthrough }));
mock.module("../context/ActivityContext", () => ({ ActivityProvider: passthrough }));
mock.module("./widgets/SearchBar", () => ({ default: () => null }));
mock.module("./auth/SessionNamePrompt", () => ({ default: () => null }));

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
let createRoot: typeof import("react-dom/client").createRoot;
let AuthWrapper: typeof import("./AuthWrapper").default;

beforeAll(async () => {
  dom = new Window({ url: "http://localhost" });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Image: dom.Image,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ default: AuthWrapper } = await import("./AuthWrapper"));
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

it("keeps dashboard effects mounted through startup and auth validation", async () => {
  let mounts = 0;
  let cleanups = 0;
  function Dashboard() {
    useEffect(() => {
      mounts += 1;
      return () => { cleanups += 1; };
    }, []);
    return <div>Dashboard</div>;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter><AuthWrapper><Dashboard /></AuthWrapper></MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(setAuth).toHaveBeenCalled();
    expect(container.textContent).toContain("Dashboard");
    expect(mounts).toBe(1);
    expect(cleanups).toBe(0);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
  expect(cleanups).toBe(1);
});

it("redirects missing sessions without mounting the dashboard", async () => {
  token = null;
  let mounts = 0;
  function Dashboard() {
    useEffect(() => { mounts += 1; }, []);
    return <div>Dashboard</div>;
  }
  function Location() {
    return <span>{useLocation().pathname}</span>;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const client = new QueryClient();
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/home"]}>
            <Location />
            <AuthWrapper><Dashboard /></AuthWrapper>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    expect(container.textContent).toBe("/auth/login");
    expect(mounts).toBe(0);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    token = "session-token";
  }
});
