import type { ActionAuth } from "@dashwise/types/sdk";
import { authHeaders, backendUrl } from "@/lib/apiClient";

export type PlaybackResourceIdentity = {
  integrationInstanceId: string;
  collectionId: string;
  resourceId: string;
};

export type PlaybackMetadata = {
  title?: string;
  artist?: string;
  artworkUrl?: string;
  durationSeconds?: number;
};

export type PlaybackSource = {
  url: string;
  metadata?: PlaybackMetadata;
  kind?: "audio" | "video";
  mimeType?: string;
};

export type MediaSession = {
  id: string;
  source: PlaybackSource;
};

export type PlaybackEventType = "started" | "paused" | "resumed" | "progress" | "ended" | "stopped" | "error";

async function request<T>(auth: ActionAuth, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(backendUrl(`/api/v1${path}`), {
    ...init,
    headers: {
      ...authHeaders(auth),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Media request failed.");
  }
  return body as T;
}

export function createMediaSession(auth: ActionAuth, resource: PlaybackResourceIdentity) {
  return request<MediaSession>(auth, "/media/sessions", {
    method: "POST",
    body: JSON.stringify({ resource }),
  });
}

export function postMediaSessionEvent(
  auth: ActionAuth,
  sessionId: string,
  event: { sequence: number; type: PlaybackEventType; positionSeconds?: number; reason?: string },
) {
  return request<{ accepted: boolean }>(auth, `/media/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export function deleteMediaSession(auth: ActionAuth, sessionId: string) {
  return request<void>(auth, `/media/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}
