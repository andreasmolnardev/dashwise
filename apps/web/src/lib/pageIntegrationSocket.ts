import { backendUrl } from "@/lib/apiClient";

type IntegrationDataMessage =
  | {
      type: "start";
      pageName: string;
      total: number;
    }
  | {
      type: "consumer";
      pageName: string;
      item: Record<string, any>;
    }
  | {
      type: "complete";
      pageName: string;
    }
  | {
      type: "error";
      pageName?: string;
      error: string;
    };

type Listener = (message: IntegrationDataMessage) => void;

type SocketState = "idle" | "connecting" | "open";

let socket: WebSocket | null = null;
let socketState: SocketState = "idle";
let socketToken: string | null = null;
let currentPageName: string | null = null;
let pendingPageName: string | null = null;

const listeners = new Set<Listener>();

function toWebSocketUrl(input: string) {
  const url = new URL(input);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

function buildSocketUrl(token: string, pageName?: string) {
  const url = toWebSocketUrl(backendUrl("/api/v1/pageConfig/integrationData"));
  url.searchParams.set("token", token);
  if (pageName) {
    url.searchParams.set("page", pageName);
  }
  return url.toString();
}

function notifyListeners(message: IntegrationDataMessage) {
  listeners.forEach((listener) => listener(message));
}

function sendSubscribe(pageName?: string) {
  if (!pageName || !socket || socket.readyState !== WebSocket.OPEN) {
    pendingPageName = pageName ?? null;
    return;
  }

  const payload = {
    type: "subscribe",
    pageName,
  };
  socket.send(JSON.stringify(payload));
  currentPageName = pageName;
}

function ensureSocket(token: string, pageName?: string) {
  if (socket && socketState !== "idle" && socketToken === token) {
    if (pageName && pageName !== currentPageName) {
      sendSubscribe(pageName);
    }
    return;
  }

  if (socket) {
    socket.close(1000, "reconnect");
  }

  socketToken = token;
  socketState = "connecting";
  currentPageName = pageName ?? null;
  pendingPageName = null;

  const url = buildSocketUrl(token, pageName);
  const nextSocket = new WebSocket(url);
  socket = nextSocket;

  nextSocket.onopen = () => {
    socketState = "open";
    if (pendingPageName) {
      sendSubscribe(pendingPageName);
      pendingPageName = null;
    }
  };

  nextSocket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    try {
      const parsed = JSON.parse(event.data) as IntegrationDataMessage;
      if (!parsed || typeof parsed.type !== "string") return;
      notifyListeners(parsed);
    } catch {
      // Ignore non-JSON payloads.
    }
  };

  nextSocket.onerror = () => {
    socketState = "idle";
  };

  nextSocket.onclose = () => {
    socketState = "idle";
  };
}

export function subscribePageIntegrationSocket(
  token: string | null | undefined,
  pageName: string | undefined,
  listener: Listener,
) {
  if (!token) {
    return () => {};
  }

  listeners.add(listener);
  ensureSocket(token, pageName);
  if (pageName && socketState === "open") {
    sendSubscribe(pageName);
  }

  return () => {
    listeners.delete(listener);
  };
}
