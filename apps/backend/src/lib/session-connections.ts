type ConnectionOptions = {
  userId: string;
  sessionId: string;
  validate: () => Promise<boolean>;
  close: () => void;
  intervalMs?: number;
};

export type SessionConnection = {
  isActive: () => boolean;
  ensureValid: () => Promise<boolean>;
  dispose: () => void;
};

const connections = new Map<string, Map<string, Set<() => void>>>();

// Register before revalidating so revocation racing with asynchronous socket
// initialization cannot leave a connection outside the revocation registry.
export function trackSessionConnection(options: ConnectionOptions): SessionConnection {
  let active = true;
  let checking: Promise<boolean> | undefined;
  const sessions = connections.get(options.userId) ?? new Map<string, Set<() => void>>();
  const session = sessions.get(options.sessionId) ?? new Set<() => void>();
  const dispose = () => {
    if (!active) return;
    active = false;
    clearInterval(timer);
    session.delete(close);
    if (!session.size) sessions.delete(options.sessionId);
    if (!sessions.size) connections.delete(options.userId);
  };
  const close = () => {
    if (!active) return;
    dispose();
    // A failed transport cleanup must not prevent other sockets from revoking.
    try { options.close(); } catch { /* The connection is already inactive. */ }
  };
  const ensureValid = async () => {
    if (!active) return false;
    if (!checking) {
      checking = options.validate().then((valid) => {
        if (!valid) close();
        return active && valid;
      }).catch(() => { close(); return false; }).finally(() => { checking = undefined; });
    }
    const valid = await checking;
    return active && valid;
  };
  session.add(close);
  sessions.set(options.sessionId, session);
  connections.set(options.userId, sessions);
  const timer = setInterval(() => { void ensureValid(); }, options.intervalMs ?? 1000);
  timer.unref?.();
  return { isActive: () => active, ensureValid, dispose };
}

export function revokeSessionConnections(userId: string, sessionId: string) {
  for (const close of [...(connections.get(userId)?.get(sessionId) ?? [])]) close();
}

export function revokeUserConnections(userId: string) {
  for (const sessionId of [...(connections.get(userId)?.keys() ?? [])]) {
    revokeSessionConnections(userId, sessionId);
  }
}
