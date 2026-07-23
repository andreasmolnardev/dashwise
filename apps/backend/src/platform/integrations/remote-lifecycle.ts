export interface CredentialResolver<TTarget, TCredential> {
  resolve(target: TTarget): TCredential | null | Promise<TCredential | null>;
}

export type RemoteErrorKind = "authentication" | "network" | "remote" | "timeout" | "unknown";

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly kind: RemoteErrorKind = "unknown",
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

export function normalizeRemoteError(error: unknown): RemoteError {
  if (error instanceof RemoteError) return error;

  if (error instanceof DOMException && error.name === "AbortError") {
    return new RemoteError("Remote request timed out", "timeout", undefined, error);
  }

  if (error instanceof Error) return new RemoteError(error.message, "network", undefined, error);
  return new RemoteError("Remote request failed", "unknown", undefined, error);
}

export function remoteHttpError(response: Response): RemoteError {
  const kind: RemoteErrorKind = response.status === 401 || response.status === 403
    ? "authentication"
    : "remote";
  return new RemoteError(`Remote service returned HTTP ${response.status}`, kind, response.status);
}

export function isRetryableRemoteError(error: unknown): boolean {
  const normalized = normalizeRemoteError(error);
  return normalized.kind === "network" || normalized.kind === "timeout" ||
    (normalized.kind === "remote" && (normalized.status ?? 0) >= 500);
}

export async function retryRemote<T>(
  operation: () => Promise<T>,
  { attempts = 1, delayMs = 0 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastError: RemoteError | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = normalizeRemoteError(error);
      if (!isRetryableRemoteError(lastError) || attempt === attempts - 1) throw lastError;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError ?? new RemoteError("Remote request failed");
}

export type IntegrationHealth = {
  status: "online" | "offline";
  checkedAt: string;
  error?: RemoteError;
};

export class PollingRegistration {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(task: () => void | Promise<void>, intervalMs: number) {
    this.timer ??= setInterval(() => void task(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export type StreamCleanup = () => void;

/** Owns remote stream cleanup so reconnects and shutdown cannot leak sockets. */
export class StreamRegistry<TKey> {
  private readonly cleanups = new Map<TKey, StreamCleanup>();

  register(key: TKey, cleanup: StreamCleanup) {
    this.close(key);
    this.cleanups.set(key, cleanup);
  }

  close(key: TKey) {
    const cleanup = this.cleanups.get(key);
    this.cleanups.delete(key);
    cleanup?.();
  }

  closeAll() {
    for (const key of [...this.cleanups.keys()]) this.close(key);
  }
}
