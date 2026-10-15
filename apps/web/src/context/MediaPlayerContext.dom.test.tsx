import { afterAll, beforeAll, describe, expect, it, mock, setDefaultTimeout } from "bun:test";
import { Window } from "happy-dom";
import React from "react";

setDefaultTimeout(15_000);

const pendingSessions = new Map<string, (session: { id: string; source: { url: string; metadata: { title: string }; kind: "audio" } }) => void>();
const createMediaSession = mock(async (_auth: unknown, resource: { resourceId: string }) => new Promise<{
  id: string;
  source: { url: string; metadata: { title: string }; kind: "audio" };
}>((resolve) => pendingSessions.set(resource.resourceId, resolve)));
const deleteMediaSession = mock(async (_auth: unknown, _sessionId: string) => undefined);
const postMediaSessionEvent = mock(async (_auth: unknown, _sessionId: string, _event: { sequence: number; type: string }) => ({ accepted: true }));
const withAuth = async <T,>(callback: (auth: Record<string, never>) => Promise<T> | T) => callback({});

mock.module("./useAuth", () => ({ default: () => ({ withAuth }) }));
mock.module("../lib/mediaPlaybackApi", () => ({ createMediaSession, deleteMediaSession, postMediaSessionEvent }));

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
let root: import("react-dom/client").Root;
let mount: HTMLElement;
let act: typeof import("react").act;
let MediaPlayerProvider: typeof import("./MediaPlayerContext").MediaPlayerProvider;
let useMediaPlayer: typeof import("./MediaPlayerContext").useMediaPlayer;

function Harness() {
  const player = useMediaPlayer();
  return <>
    <button onClick={() => void player.playResource({ integrationInstanceId: "instance", collectionId: "tracks", resourceId: "slow" }, { metadata: { title: "slow track" } })}>play slow</button>
    <button onClick={() => void player.playResource({ integrationInstanceId: "instance", collectionId: "tracks", resourceId: "fast" }, { metadata: { title: "fast track" } })}>play fast</button>
    <button onClick={() => player.enqueue({ integrationInstanceId: "instance", collectionId: "tracks", resourceId: "queued" }, { metadata: { title: "queued track" } })}>enqueue track</button>
    <button onClick={() => void player.playUrl("/direct.mp3", { title: "direct track" })}>play direct url</button>
    <output>{player.current?.source?.metadata?.title ?? (player.current?.loading ? "loading" : "idle")}</output>
  </>;
}

function click(selector: string) {
  mount.querySelector(selector)?.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }) as unknown as Event);
}

beforeAll(async () => {
  dom = new Window({ url: "http://localhost" });
  originalGlobals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLMediaElement: dom.HTMLMediaElement,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
  })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(dom.HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.reject(new Error("autoplay blocked in test")),
  });
  ({ act } = await import("react"));
  const { createRoot } = await import("react-dom/client");
  mount = dom.document.createElement("div") as unknown as HTMLElement;
  dom.document.body.appendChild(mount as never);
  root = createRoot(mount);
  ({ MediaPlayerProvider, useMediaPlayer } = await import("./MediaPlayerContext"));
});

afterAll(async () => {
  await act(async () => root.unmount());
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe("MediaPlayerProvider", () => {
  it("ignores a stale resolution and closes its superseded session", async () => {
    pendingSessions.clear();
    createMediaSession.mockClear();
    deleteMediaSession.mockClear();
    await act(async () => root.render(<MediaPlayerProvider><Harness /></MediaPlayerProvider>));
    await act(async () => click("button:nth-of-type(1)"));
    await act(async () => click("button:nth-of-type(2)"));
    await act(async () => {
      pendingSessions.get("fast")?.({ id: "session-fast", source: { url: "/fast.mp3", metadata: { title: "fast track" }, kind: "audio" } });
      await Promise.resolve();
    });
    expect(mount.querySelector("output")?.textContent).toBe("fast track");
    const audio = mount.querySelector("audio")!;
    await act(async () => {
      audio.dispatchEvent(new dom.Event("playing") as unknown as Event);
      audio.dispatchEvent(new dom.Event("playing") as unknown as Event);
      audio.dispatchEvent(new dom.Event("pause") as unknown as Event);
      audio.dispatchEvent(new dom.Event("playing") as unknown as Event);
      audio.dispatchEvent(new dom.Event("playing") as unknown as Event);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(postMediaSessionEvent.mock.calls.map(([, , event]) => event.type)).toEqual(["started", "paused", "resumed"]);
    await act(async () => click("button:nth-of-type(3)"));
    expect(mount.querySelector("details")?.textContent).toContain("1 queued");
    expect(mount.querySelector("details")?.textContent).toContain("queued track");
    await act(async () => click("details button"));
    expect(mount.querySelector("details")).toBeNull();

    await act(async () => {
      pendingSessions.get("slow")?.({ id: "session-slow", source: { url: "/slow.mp3", metadata: { title: "slow track" }, kind: "audio" } });
      await Promise.resolve();
    });
    expect(mount.querySelector("output")?.textContent).toBe("fast track");
    expect(deleteMediaSession).toHaveBeenCalledTimes(1);
    expect(deleteMediaSession.mock.calls[0]?.[1]).toBe("session-slow");
    await act(async () => click("button:nth-of-type(4)"));
    expect(mount.querySelector("output")?.textContent).toBe("direct track");
    expect(mount.querySelector("audio")).not.toBeNull();
    expect(mount.querySelector("video")).not.toBeNull();
    expect(mount.querySelector("section[aria-label='media player']")?.textContent).toContain("direct track");
    await act(async () => root.unmount());
    await Promise.resolve();
    expect(deleteMediaSession).toHaveBeenCalledTimes(2);
    expect(deleteMediaSession.mock.calls[1]?.[1]).toBe("session-fast");
  });
});
