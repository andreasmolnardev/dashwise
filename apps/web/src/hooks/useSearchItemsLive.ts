import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";
import { backendUrl } from "@/lib/apiClient";
import { getSearchItemsAction } from "@/lib/apiClient";
import { queryKeys } from "@/lib/queryClient";

type StateUpdate = { itemId?: string; states?: unknown[] };
type CachedSearchItem = { id?: unknown; states?: unknown[]; [key: string]: unknown };
type PendingAction = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number };

function socketUrl(token: string) {
  const url = new URL(backendUrl("api/v1/searchItems/live"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

export function useSearchItemsLive() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const socketRef = useRef<WebSocket | null>(null);
  const pendingActions = useRef(new Map<string, PendingAction>());

  const sendStatefulAction = useCallback((itemId: string, action: string): Promise<unknown> | null => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return null;
    const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingActions.current.delete(requestId);
        reject(new Error("Stateful action timed out"));
      }, 8_000);
      pendingActions.current.set(requestId, { resolve, reject, timer });
    });
    socket.send(JSON.stringify({ type: "searchItems:action", requestId, itemId, action }));
    return promise;
  }, []);

  useEffect(() => {
    if (!token) return;
    let closed = false;
    let reconnectTimer: number | undefined;
    const pollTimer = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) return;
      void queryClient.fetchQuery({
        queryKey: ["api", token, ...queryKeys.links.search],
        queryFn: () => getSearchItemsAction({ token }),
        staleTime: 0,
      }).catch(() => undefined);
    }, 30_000);
    let socket: WebSocket | undefined;

    const updateItems = (updater: (items: CachedSearchItem[]) => CachedSearchItem[]) => {
      queryClient.setQueryData(["api", token, ...queryKeys.links.search], (current: unknown) =>
        Array.isArray(current) ? updater(current) : current,
      );
    };

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(socketUrl(token));
      socketRef.current = socket;
      socket.onopen = () => socket?.send(JSON.stringify({ type: "searchItems:subscribe" }));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "searchItems:snapshot" && Array.isArray(message.items)) {
            queryClient.setQueryData(["api", token, ...queryKeys.links.search], message.items);
          } else if (message.type === "searchItems:state") {
            const update = message as StateUpdate;
            if (!update.itemId || !Array.isArray(update.states)) return;
            updateItems((items) => items.map((item) =>
              item?.id === update.itemId ? { ...item, states: update.states } : item,
            ));
          } else if (message.type === "searchItems:actionResult" && typeof message.requestId === "string") {
            const pending = pendingActions.current.get(message.requestId);
            if (!pending) return;
            window.clearTimeout(pending.timer);
            pendingActions.current.delete(message.requestId);
            if (message.success) pending.resolve(message);
            else pending.reject(new Error(String(message.error || "Stateful action failed")));
          }
        } catch {
          // Retain the last known state for malformed messages.
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        for (const [requestId, pending] of pendingActions.current) {
          window.clearTimeout(pending.timer);
          pending.reject(new Error("State synchronization connection closed"));
          pendingActions.current.delete(requestId);
        }
        if (!closed) reconnectTimer = window.setTimeout(connect, 3_000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.clearInterval(pollTimer);
      socket?.close();
      for (const [requestId, pending] of pendingActions.current) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error("State synchronization stopped"));
        pendingActions.current.delete(requestId);
      }
    };
  }, [queryClient, token]);

  return { sendStatefulAction };
}
