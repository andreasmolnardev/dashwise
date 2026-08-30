type ActivitySubscriber = () => Promise<void>;

export type ActivityConnection = {
  send: (data: string) => void;
};

export type ShortcutExecutionResult = {
  success: boolean;
  requestId: string;
  error?: string;
};

const subscribers = new Map<string, Set<ActivitySubscriber>>();
const sessionConnections = new Map<string, Map<string, Set<ActivityConnection>>>();
const pendingShortcutRequests = new Map<string, {
  userId: string;
  sessionId: string;
  resolve: (result: ShortcutExecutionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

const SHORTCUT_RESULT_TIMEOUT_MS = 10_000;

export function subscribeActivity(userId: string, subscriber: ActivitySubscriber) {
  const userSubscribers = subscribers.get(userId) ?? new Set<ActivitySubscriber>();
  userSubscribers.add(subscriber);
  subscribers.set(userId, userSubscribers);

  return () => {
    userSubscribers.delete(subscriber);
    if (userSubscribers.size === 0) subscribers.delete(userId);
  };
}

export function broadcastActivity(userId: string) {
  for (const subscriber of subscribers.get(userId) ?? []) {
    void subscriber().catch(() => undefined);
  }
}

export function registerSessionConnection(
  userId: string,
  sessionId: string,
  connection: ActivityConnection,
) {
  const userSessions = sessionConnections.get(userId) ?? new Map();
  const connections = userSessions.get(sessionId) ?? new Set<ActivityConnection>();
  connections.add(connection);
  userSessions.set(sessionId, connections);
  sessionConnections.set(userId, userSessions);

  return () => unregisterSessionConnection(userId, sessionId, connection);
}

export function unregisterSessionConnection(
  userId: string,
  sessionId: string,
  connection: ActivityConnection,
) {
  const userSessions = sessionConnections.get(userId);
  const connections = userSessions?.get(sessionId);
  if (!connections) return;

  connections.delete(connection);
  if (connections.size > 0) return;

  userSessions?.delete(sessionId);
  if (userSessions && userSessions.size === 0) sessionConnections.delete(userId);

  for (const [requestId, request] of pendingShortcutRequests) {
    if (request.userId !== userId || request.sessionId !== sessionId) continue;
    finishShortcutRequest(requestId, {
      success: false,
      requestId,
      error: "Target session disconnected before the shortcut completed",
    });
  }
}

export function isSessionConnected(userId: string, sessionId: string) {
  return (sessionConnections.get(userId)?.get(sessionId)?.size ?? 0) > 0;
}

export function sendToSession(
  userId: string,
  sessionId: string,
  message: Record<string, unknown>,
) {
  const connections = sessionConnections.get(userId)?.get(sessionId);
  if (!connections?.size) return false;

  const payload = JSON.stringify(message);
  let sent = false;
  for (const connection of connections) {
    try {
      connection.send(payload);
      sent = true;
    } catch {
      unregisterSessionConnection(userId, sessionId, connection);
    }
  }
  return sent;
}

export function handleActivityMessage(
  userId: string,
  sessionId: string,
  connection: ActivityConnection,
  message: unknown,
) {
  if (!message || typeof message !== "object") return false;
  const payload = message as Record<string, unknown>;
  if (payload.type !== "shortcut:result" || typeof payload.requestId !== "string") return false;

  const request = pendingShortcutRequests.get(payload.requestId);
  if (!request || request.userId !== userId || request.sessionId !== sessionId) return false;
  if (!sessionConnections.get(userId)?.get(sessionId)?.has(connection)) return false;

  const error = typeof payload.error === "string" ? payload.error.trim().slice(0, 500) : "";
  finishShortcutRequest(payload.requestId, {
    success: payload.success === true,
    requestId: payload.requestId,
    ...(payload.success === true ? {} : { error: error || "The client failed to execute the shortcut" }),
  });
  return true;
}

export function requestShortcutExecution(
  userId: string,
  sessionId: string,
  shortcutId: string,
): Promise<ShortcutExecutionResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      finishShortcutRequest(requestId, {
        success: false,
        requestId,
        error: "Timed out waiting for the target session to execute the shortcut",
      });
    }, SHORTCUT_RESULT_TIMEOUT_MS);

    pendingShortcutRequests.set(requestId, {
      userId,
      sessionId,
      resolve,
      timer,
    });

    if (!sendToSession(userId, sessionId, {
      type: "shortcut:execute",
      requestId,
      shortcutId,
    })) {
      finishShortcutRequest(requestId, {
        success: false,
        requestId,
        error: "Target session is offline",
      });
    }
  });
}

function finishShortcutRequest(requestId: string, result: ShortcutExecutionResult) {
  const request = pendingShortcutRequests.get(requestId);
  if (!request) return;
  pendingShortcutRequests.delete(requestId);
  clearTimeout(request.timer);
  request.resolve(result);
}
