import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import React, { act, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { createQueryClient } from "../../lib/queryClient";

const OPEN_EVENT = "dashwise:open-command-bar";
let requests = 0;
let mounts = 0;
const subscribeSdkResources = () => () => {};
mock.module("../../context/useAuth", () => ({
  COMMAND_BAR_OPEN_EVENT: OPEN_EVENT,
  default: () => ({ token: "session", user: { searchPreferences: {} } }),
}));
mock.module("../../context/ActivityContext", () => ({ useActivity: () => ({ subscribeSdkResources }) }));
mock.module("../../lib/apiClient", () => ({ getShortcutsAction: async () => { requests++; return []; } }));
mock.module("./CommandBar", () => ({ default: function CommandBar({ open, setOpen }: { open: boolean; setOpen: Dispatch<SetStateAction<boolean>> }) {
  const [pending, setPending] = useState(false);
  useEffect(() => { mounts++; }, []);
  return <>
    {open && <div role="dialog"><button onClick={() => { setPending(true); setOpen(false); }}>Run action</button></div>}
    {pending && <span>Pending action</span>}
  </>;
} }));

let dom: Window;
let createRoot: typeof import("react-dom/client").createRoot;
let SearchBar: typeof import("./SearchBar").default;
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
beforeAll(async () => {
  dom = new Window({ url: "http://localhost" });
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Event: dom.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ default: SearchBar } = await import("./SearchBar"));
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
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}

it("defers search until opened and shares one host across triggers and shortcuts", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = createQueryClient();
  try {
    await act(async () => root.render(<QueryClientProvider client={client}>
      <SearchBar useRedirect={false} showTrigger={false} enableGlobalShortcut />
      <SearchBar useRedirect={false} />
      <SearchBar useRedirect={false} />
    </QueryClientProvider>));
    await settle();
    expect(mounts).toBe(0);
    expect(requests).toBe(0);
    const trigger = container.querySelector("input")!;
    await act(async () => { trigger.dispatchEvent(new dom.FocusEvent("focusin", { bubbles: true }) as unknown as FocusEvent); });
    await settle();
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(mounts).toBe(1);
    expect(requests).toBe(1);
    await act(async () => { container.querySelector("button")!.click(); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Pending action");
    await act(async () => { window.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "k", ctrlKey: true }) as unknown as KeyboardEvent); });
    await settle();
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(mounts).toBe(1);
    expect(requests).toBe(1);
    await act(async () => { window.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "k", metaKey: true }) as unknown as KeyboardEvent); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { window.dispatchEvent(new Event(OPEN_EVENT)); });
    await settle();
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(1);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});

it("honors search opened from the dashboard URL on the initial render", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const client = createQueryClient();
  try {
    await act(async () => root.render(<QueryClientProvider client={client}>
      <SearchBar useRedirect={false} showTrigger={false} enableGlobalShortcut />
      <SearchBar useRedirect={false} defaultOpen />
    </QueryClientProvider>));
    await settle();
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(1);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
