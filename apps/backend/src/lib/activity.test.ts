import { describe, expect, test } from "bun:test";

import {
  handleActivityMessage,
  isSessionConnected,
  registerSessionConnection,
  requestShortcutExecution,
} from "./activity";

type FakeConnection = {
  sent: string[];
  send: (payload: string) => void;
};

function fakeConnection(): FakeConnection {
  const connection: FakeConnection = {
    sent: [],
    send(payload) {
      this.sent.push(payload);
    },
  };
  return connection;
}

describe("activity shortcut routing", () => {
  test("routes a request and resolves the matching result", async () => {
    const connection = fakeConnection();
    const unregister = registerSessionConnection("user-a", "session-a", connection);

    const request = requestShortcutExecution("user-a", "session-a", "open-terminal");
    expect(isSessionConnected("user-a", "session-a")).toBe(true);
    expect(connection.sent).toHaveLength(1);
    expect(JSON.parse(connection.sent[0])).toMatchObject({
      type: "shortcut:execute",
      shortcutId: "open-terminal",
    });

    const requestId = JSON.parse(connection.sent[0]).requestId;
    expect(handleActivityMessage("user-a", "session-a", connection, {
      type: "shortcut:result",
      requestId,
      success: true,
    })).toBe(true);
    await expect(request).resolves.toMatchObject({ success: true, requestId });

    unregister();
    expect(isSessionConnected("user-a", "session-a")).toBe(false);
  });

  test("rejects a result from another user or unregistered connection", async () => {
    const connection = fakeConnection();
    const otherConnection = fakeConnection();
    const unregister = registerSessionConnection("user-b", "session-b", connection);
    const unregisterOther = registerSessionConnection("user-a", "session-b", otherConnection);

    const request = requestShortcutExecution("user-b", "session-b", "open-terminal");
    const requestId = JSON.parse(connection.sent[0]).requestId;
    expect(handleActivityMessage("user-a", "session-b", otherConnection, {
      type: "shortcut:result",
      requestId,
      success: true,
    })).toBe(false);
    expect(handleActivityMessage("user-b", "session-b", otherConnection, {
      type: "shortcut:result",
      requestId,
      success: true,
    })).toBe(false);
    expect(handleActivityMessage("user-b", "session-b", connection, {
      type: "shortcut:result",
      requestId,
      success: false,
      error: "Not exposed",
    })).toBe(true);
    await expect(request).resolves.toMatchObject({
      success: false,
      error: "Not exposed",
    });

    unregister();
    unregisterOther();
  });

  test("fails immediately when the target session has no connection", async () => {
    await expect(requestShortcutExecution("user-a", "offline", "shortcut-id")).resolves.toMatchObject({
      success: false,
      error: "Target session is offline",
    });
  });

  test("fails pending requests when the last connection closes", async () => {
    const connection = fakeConnection();
    const unregister = registerSessionConnection("user-a", "session-c", connection);
    const request = requestShortcutExecution("user-a", "session-c", "shortcut-id");

    unregister();

    await expect(request).resolves.toMatchObject({
      success: false,
      error: "Target session disconnected before the shortcut completed",
    });
    expect(isSessionConnected("user-a", "session-c")).toBe(false);
  });
});
