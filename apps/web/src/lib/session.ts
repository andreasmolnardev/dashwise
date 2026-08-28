const SESSION_ID_STORAGE_KEY = "dashwise_session_id";

function createFallbackSessionId() {
  if (typeof window !== "undefined" && typeof window.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    const randomPart = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `web-${Date.now().toString(36)}-${randomPart}`;
  }

  return `web-${Date.now().toString(36)}-${performance.now().toString(36).replace(".", "")}`;
}

/** Returns the browser identity that survives logout, login, and token refreshes. */
export function getClientSessionId() {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.localStorage.getItem(SESSION_ID_STORAGE_KEY)?.trim();
    if (existing) return existing;

    const sessionId = typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : createFallbackSessionId();
    window.localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
    return sessionId;
  } catch {
    return null;
  }
}

export function getClientSessionHeaders(preferredSessionId?: string | null) {
  const sessionId = preferredSessionId?.trim() || getClientSessionId();
  if (!sessionId) return {};

  return {
    "X-Session-Id": sessionId,
    "X-Client-Type": "browser",
    ...(typeof navigator !== "undefined" && navigator.platform
      ? { "X-Platform": navigator.platform.slice(0, 100) }
      : {}),
  };
}
