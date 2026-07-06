"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

import useAuth from "@/context/useAuth";
import { backendUrl, type MonitoringSshHostRecord } from "@/lib/apiClient";

import "xterm/css/xterm.css";
import AppIcon from "@dashwise/app-icon";

type SshSession = {
  hostId: string;
  title: string;
  subtitle: string;
};

type SshSessionsContextValue = {
  openSession: (hostId: string) => void;
  activateSession: (hostId: string) => void;
  sessions: SshSession[];
  activeHostId: string | null;
};

const SshSessionsContext = createContext<SshSessionsContextValue | null>(null);

export function useSshSessions() {
  const context = useContext(SshSessionsContext);
  if (!context) {
    throw new Error("useSshSessions must be used within SshSessionsProvider");
  }
  return context;
}

function formatHostLabel(
  host: MonitoringSshHostRecord | undefined,
  fallbackHostId: string,
) {
  if (!host) {
    return {
      title: fallbackHostId,
      subtitle: "SSH session",
    };
  }

  return {
    title: host.name || `${host.username}@${host.hostname}:${host.port}`,
    subtitle: `${host.username}@${host.hostname}:${host.port}`,
  };
}

function SshTerminalSession(
  { session, active }: { session: SshSession; active: boolean },
) {
  const { token } = useAuth();
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container || !token || !session.hostId) return;

    let disposed = false;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      scrollback: 3000,
      theme: {
        background: "#000000",
        foreground: "#f5f5f5",
        cursor: "#f5f5f5",
        selectionBackground: "rgba(255, 255, 255, 0.2)",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const url = new URL(
      backendUrl(`/api/v1/monitoring/ssh-hosts/${session.hostId}/console`),
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);

    const socket = new WebSocket(url.toString());
    wsRef.current = socket;

    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    };

    const onDataDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    const onResizeDisposable = terminal.onResize(() => {
      sendResize();
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        sendResize();
      } catch {
        // Ignore layout settling jitter.
      }
    });
    resizeObserver.observe(container);

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          data?: string;
          message?: string;
        };

        if (message.type === "stdout" || message.type === "stderr") {
          terminal.write(String(message.data ?? ""));
          return;
        }

        if (message.message) {
          terminal.writeln(message.message);
          return;
        }

        terminal.write(String(event.data));
      } catch {
        terminal.write(String(event.data));
      }
    };

    socket.onerror = () => {
      if (!disposed) terminal.writeln("\r\nWebsocket error.");
    };

    socket.onopen = () => {
      if (disposed) return;
      fitAddon.fit();
      sendResize();
      if (active) {
        terminal.focus();
      }
    };

    socket.onclose = () => {
      if (!disposed) terminal.writeln("\r\nSession closed.");
    };

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      socket.close();
      wsRef.current = null;
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [session.hostId, token]);

  useEffect(() => {
    if (!active) return;
    try {
      fitAddonRef.current?.fit();
      terminalRef.current?.focus();
    } catch {
      // Ignore if the tab is still laying out.
    }
  }, [active]);

  return (
    <div className={active ? "h-full min-h-0" : "hidden"}>
      <div ref={terminalContainerRef} className="h-full max-h-full w-full min-h-0" />
    </div>
  );
}

export default function SshSessionsProvider({
  hosts,
  children,
}: {
  hosts: MonitoringSshHostRecord[];
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [host.id, host] as const)),
    [hosts],
  );
  const [sessions, setSessions] = useState<SshSession[]>([]);
  const [activeHostId, setActiveHostId] = useState<string | null>(null);

  const openSession = useCallback((hostId: string) => {
    const label = formatHostLabel(hostById.get(hostId), hostId);

    setSessions((current) => {
      const existing = current.find((session) => session.hostId === hostId);
      if (existing) {
        return current.map((
          session,
        ) => (session.hostId === hostId ? { ...session, ...label } : session));
      }

      return [...current, { hostId, ...label }];
    });
    setActiveHostId(hostId);
  }, [hostById]);

  const activateSession = useCallback((hostId: string) => {
    setActiveHostId(hostId);
    navigate(`/apps/monitoring/ssh/${hostId}`);
  }, [navigate]);

  const closeSession = useCallback((hostId: string) => {
    const closingIndex = sessions.findIndex((session) =>
      session.hostId === hostId
    );
    const next = sessions.filter((session) => session.hostId !== hostId);

    setSessions(next);

    if (activeHostId === hostId) {
      const nextActive = next[closingIndex] ?? next[closingIndex - 1] ?? null;
      setActiveHostId(nextActive?.hostId ?? null);

      if (nextActive) {
        navigate(`/apps/monitoring/ssh/${nextActive.hostId}`);
      } else {
        navigate("/apps/monitoring/ssh");
      }
    }
  }, [activeHostId, navigate, sessions]);

  useEffect(() => {
    setSessions((current) =>
      current.map((session) => {
        const label = formatHostLabel(
          hostById.get(session.hostId),
          session.hostId,
        );
        if (
          session.title === label.title && session.subtitle === label.subtitle
        ) {
          return session;
        }
        return { ...session, ...label };
      })
    );
  }, [hostById]);

  const isSshRoute = location.pathname.startsWith("/apps/monitoring/ssh/");

  const value = useMemo(() => ({
    openSession,
    activateSession,
    sessions,
    activeHostId,
  }), [activeHostId, activateSession, openSession, sessions]);

  return (
    <SshSessionsContext.Provider value={value}>
      <div
        className={isSshRoute
          ? "flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden"
          : "contents"}
      >
        {children}
        {isSshRoute && sessions.length > 0
          ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap gap-2 shrink-0">
                {sessions.map((session) => {
                  const active = session.hostId === activeHostId;
                  return (
                    <div
                      key={session.hostId}
                      className={`group min-w-44 rounded-lg frosted px-2 py-1 text-left transition-all duration-200 flex items-center gap-2 ${
                        active ? "bg-white/10" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => activateSession(session.hostId)}
                        className="min-w-0 flex-1 text-left text-sm font-medium leading-5"
                      >
                        {session.title}
                      </button>
                      <button
                        type="button"
                        aria-label={`Close ${session.title} session`}
                        onClick={() => closeSession(session.hostId)}
                        className="rounded-md p-1 text-white/60 transition-all duration-200 hover:scale-110 hover:bg-white/10 hover:text-white"
                      >
                        <AppIcon source="fa6-solid:xmark" className="pt-0.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/70 shadow-2xl shadow-black/30">
                {sessions.map((session) => (
                  <SshTerminalSession
                    key={session.hostId}
                    session={session}
                    active={session.hostId === activeHostId}
                  />
                ))}
              </div>
            </div>
          )
          : null}
      </div>
    </SshSessionsContext.Provider>
  );
}
