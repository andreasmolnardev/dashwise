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

type SessionValidation = {
  validate: () => Promise<boolean>;
  intervalMs: number;
  checking?: Promise<boolean>;
  timer?: ReturnType<typeof setInterval>;
};

const connections = new Map<string, Map<string, Set<() => void>>>();
const validations = new Map<string, Map<string, SessionValidation>>();

// Register before revalidating so revocation racing with asynchronous socket
// initialization cannot leave a connection outside the revocation registry.
export function trackSessionConnection(options: ConnectionOptions): SessionConnection {
  let active = true;
  const sessions = connections.get(options.userId) ?? new Map<string, Set<() => void>>();
  const session = sessions.get(options.sessionId) ?? new Set<() => void>();
  const userValidations = validations.get(options.userId) ?? new Map<string, SessionValidation>();
  const validation = userValidations.get(options.sessionId) ?? {
    validate: options.validate,
    intervalMs: options.intervalMs ?? 1000,
  };
  const previousIntervalMs = validation.intervalMs;
  validation.intervalMs = Math.min(validation.intervalMs, options.intervalMs ?? 1000);
  if (validation.intervalMs < previousIntervalMs && validation.timer) {
    clearInterval(validation.timer);
    validation.timer = undefined;
  }
  const validateSession = () => {
    if (!validation.checking) {
      validation.checking = validation.validate().then((valid) => {
        if (!valid && validations.get(options.userId)?.get(options.sessionId) === validation) {
          revokeSessionConnections(options.userId, options.sessionId);
        }
        return valid;
      }).catch(() => {
        if (validations.get(options.userId)?.get(options.sessionId) === validation) {
          revokeSessionConnections(options.userId, options.sessionId);
        }
        return false;
      }).finally(() => { validation.checking = undefined; });
    }
    return validation.checking;
  };

  const dispose = () => {
    if (!active) return;
    active = false;
    session.delete(close);
    if (!session.size) {
      sessions.delete(options.sessionId);
      if (validation.timer) clearInterval(validation.timer);
      userValidations.delete(options.sessionId);
    }
    if (!sessions.size) connections.delete(options.userId);
    if (!userValidations.size) validations.delete(options.userId);
  };
  const close = () => {
    if (!active) return;
    dispose();
    // A failed transport cleanup must not prevent other sockets from revoking.
    try { options.close(); } catch { /* The connection is already inactive. */ }
  };
  const ensureValid = async () => {
    if (!active) return false;
    const valid = await validateSession();
    return active && valid;
  };
  session.add(close);
  sessions.set(options.sessionId, session);
  connections.set(options.userId, sessions);
  userValidations.set(options.sessionId, validation);
  validations.set(options.userId, userValidations);
  if (!validation.timer) {
    validation.timer = setInterval(() => { void validateSession(); }, validation.intervalMs);
    validation.timer.unref?.();
  }
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
