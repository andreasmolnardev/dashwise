"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import useAuth from "@/context/useAuth";
import { backendUrl } from "@/lib/apiClient";
import {
  createMediaSession,
  deleteMediaSession,
  postMediaSessionEvent,
  type MediaSession,
  type PlaybackEventType,
  type PlaybackMetadata,
  type PlaybackResourceIdentity,
  type PlaybackSource,
} from "@/lib/mediaPlaybackApi";

type DirectTrack = { type: "url"; source: PlaybackSource };
type ResourceTrack = { type: "resource"; resource: PlaybackResourceIdentity; metadata?: PlaybackMetadata; kind?: "audio" | "video" };
type TrackRequest = DirectTrack | ResourceTrack;
type CurrentTrack = { request: TrackRequest; source: PlaybackSource | null; sessionId?: string; loading: boolean; error?: string };

type MediaPlayerContextValue = {
  current: CurrentTrack | null;
  upcoming: TrackRequest[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playResource: (resource: PlaybackResourceIdentity, options?: { metadata?: PlaybackMetadata; kind?: "audio" | "video" }) => Promise<void>;
  enqueue: (resource: PlaybackResourceIdentity, options?: { metadata?: PlaybackMetadata; kind?: "audio" | "video" }) => void;
  playUrl: (url: string, metadata?: PlaybackMetadata, options?: { kind?: "audio" | "video"; mimeType?: string }) => Promise<void>;
  toggle: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  next: () => void;
  previous: () => void;
  playQueued: (index: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  clear: () => void;
};

const MediaPlayerContext = createContext<MediaPlayerContextValue | null>(null);
export function useMediaPlayer() {
  const context = useContext(MediaPlayerContext);
  if (!context) throw new Error("useMediaPlayer must be used within MediaPlayerProvider");
  return context;
}

function requestFromResource(resource: PlaybackResourceIdentity, options?: { metadata?: PlaybackMetadata; kind?: "audio" | "video" }): ResourceTrack {
  return { type: "resource", resource, metadata: options?.metadata, kind: options?.kind };
}

export function MediaPlayerProvider({ children }: { children: ReactNode }) {
  const { withAuth } = useAuth();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [current, setCurrent] = useState<CurrentTrack | null>(null);
  const [upcoming, setUpcoming] = useState<TrackRequest[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [videoVisible, setVideoVisible] = useState(false);
  const runRef = useRef(0);
  const sequenceRef = useRef(new Map<string, number>());
  const eventChainsRef = useRef(new Map<string, Promise<void>>());
  const closedSessionsRef = useRef(new Set<string>());
  const currentRef = useRef(current);
  currentRef.current = current;
  const closeSessionRef = useRef<(sessionId: string, positionSeconds?: number, reason?: string) => Promise<void>>(async () => undefined);
  const startedRef = useRef(false);
  const startedSessionRef = useRef<string | null>(null);
  const playbackPausedRef = useRef(false);
  const retryRequiredRef = useRef(false);
  const replacingSourceRef = useRef(false);
  const lastProgressAtRef = useRef(0);
  const upcomingRef = useRef(upcoming);
  upcomingRef.current = upcoming;

  const activeElement = current?.source?.kind === "video" ? videoRef.current : audioRef.current;
  const isCurrentMediaElement = useCallback((element: HTMLMediaElement) => {
    if (!current?.source) return false;
    const active = current.source.kind === "video" ? videoRef.current : audioRef.current;
    if (element !== active) return false;
    return !element.currentSrc || element.currentSrc === current.source.url;
  }, [current?.source]);

  const sendEvent = useCallback((sessionId: string, type: PlaybackEventType, positionSeconds?: number, reason?: string) => {
    const sequence = (sequenceRef.current.get(sessionId) ?? 0) + 1;
    sequenceRef.current.set(sessionId, sequence);
    const previous = eventChainsRef.current.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await withAuth((auth) => postMediaSessionEvent(auth, sessionId, {
        sequence,
        type,
        positionSeconds: positionSeconds == null ? undefined : Math.max(0, positionSeconds),
        reason,
      }));
    }).catch((error) => {
      console.warn("Could not report media playback event", error);
    });
    eventChainsRef.current.set(sessionId, next);
    return next;
  }, [withAuth]);

  const closeSession = useCallback(async (sessionId: string, positionSeconds?: number, reason?: string) => {
    if (closedSessionsRef.current.has(sessionId)) return;
    closedSessionsRef.current.add(sessionId);
    if (startedSessionRef.current === sessionId) {
      await sendEvent(sessionId, "stopped", positionSeconds, reason);
      startedSessionRef.current = null;
    }
    await (eventChainsRef.current.get(sessionId) ?? Promise.resolve()).catch(() => undefined);
    await withAuth((auth) => deleteMediaSession(auth, sessionId)).catch(() => undefined);
    sequenceRef.current.delete(sessionId);
    eventChainsRef.current.delete(sessionId);
  }, [sendEvent, withAuth]);
  closeSessionRef.current = closeSession;

  const resolveAndPlay = useCallback(async (request: TrackRequest) => {
    const run = ++runRef.current;
    const previous = currentRef.current;
    if (previous?.sessionId) {
      void closeSession(previous.sessionId, activeElement?.currentTime, "track_changed");
    }
    replacingSourceRef.current = true;
    const previousElement = previous?.source?.kind === "video" ? videoRef.current : audioRef.current;
    if (previousElement) {
      previousElement.pause();
      previousElement.removeAttribute("src");
      previousElement.load();
    }
    startedRef.current = false;
    startedSessionRef.current = null;
    playbackPausedRef.current = false;
    retryRequiredRef.current = false;
    lastProgressAtRef.current = 0;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setCurrent({ request, source: request.type === "url" ? request.source : null, loading: request.type === "resource" });

    let session: MediaSession | undefined;
    try {
      if (request.type === "resource") {
        session = await withAuth((auth) => createMediaSession(auth, request.resource));
      }
      if (run !== runRef.current) {
        if (session) void closeSession(session.id, undefined, "superseded");
        return;
      }
      const base = session?.source ?? (request.type === "url" ? request.source : null);
      if (!base?.url) throw new Error("The media source did not include a playable URL.");
      const source: PlaybackSource = {
        ...base,
        url: backendUrl(base.url),
        kind: base.kind ?? (request.type === "resource" ? request.kind : undefined) ?? "audio",
        metadata: base.metadata ?? (request.type === "resource" ? request.metadata : undefined),
      };
      setCurrent({ request, source, sessionId: session?.id, loading: false });
      if (source.kind === "video") setVideoVisible(true);
    } catch (cause) {
      if (run !== runRef.current) return;
      if (session) void closeSession(session.id, undefined, "resolve_failed");
      replacingSourceRef.current = false;
      setCurrent({ request, source: null, loading: false, error: cause instanceof Error ? cause.message : "Could not resolve media." });
    }
  }, [activeElement, closeSession, withAuth]);

  const playResource = useCallback((resource: PlaybackResourceIdentity, options?: { metadata?: PlaybackMetadata; kind?: "audio" | "video" }) => {
    setUpcoming([]);
    return resolveAndPlay(requestFromResource(resource, options));
  }, [resolveAndPlay]);

  const playUrl = useCallback((url: string, metadata?: PlaybackMetadata, options?: { kind?: "audio" | "video"; mimeType?: string }) => {
    setUpcoming([]);
    return resolveAndPlay({ type: "url", source: { url, metadata, kind: options?.kind, mimeType: options?.mimeType } });
  }, [resolveAndPlay]);

  const enqueue = useCallback((resource: PlaybackResourceIdentity, options?: { metadata?: PlaybackMetadata; kind?: "audio" | "video" }) => {
    const request = requestFromResource(resource, options);
    if (!current) void resolveAndPlay(request);
    else setUpcoming((items) => [...items, request]);
  }, [current, resolveAndPlay]);

  const next = useCallback(() => {
    const [first, ...rest] = upcomingRef.current;
    if (!first) return;
    setUpcoming(rest);
    void resolveAndPlay(first);
  }, [resolveAndPlay]);

  const previous = useCallback(() => {
    const element = current?.source?.kind === "video" ? videoRef.current : audioRef.current;
    if (element && element.currentTime > 3) {
      element.currentTime = 0;
      return;
    }
    if (current) void resolveAndPlay(current.request);
  }, [current, resolveAndPlay]);

  const removeFromQueue = useCallback((index: number) => {
    setUpcoming((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const playQueued = useCallback((index: number) => {
    const request = upcomingRef.current[index];
    if (!request) return;
    setUpcoming((items) => items.filter((_, itemIndex) => itemIndex !== index));
    void resolveAndPlay(request);
  }, [resolveAndPlay]);

  const clearQueue = useCallback(() => setUpcoming([]), []);

  const clear = useCallback(() => {
    runRef.current++;
    const sessionId = current?.sessionId;
    if (sessionId) {
      void closeSession(sessionId, activeElement?.currentTime, "cleared");
    }
    replacingSourceRef.current = true;
    audioRef.current?.pause();
    videoRef.current?.pause();
    audioRef.current?.removeAttribute("src");
    videoRef.current?.removeAttribute("src");
    audioRef.current?.load();
    videoRef.current?.load();
    startedRef.current = false;
    startedSessionRef.current = null;
    playbackPausedRef.current = false;
    retryRequiredRef.current = false;
    setCurrent(null);
    setUpcoming([]);
    setIsPlaying(false);
    setVideoVisible(false);
  }, [activeElement, closeSession, current?.sessionId]);

  const toggle = useCallback(() => {
    if (retryRequiredRef.current && current) {
      void resolveAndPlay(current.request);
      return;
    }
    const element = current?.source?.kind === "video" ? videoRef.current : audioRef.current;
    if (!element || !current?.source || current.loading) return;
    if (element.paused) void element.play().catch((error) => {
      setCurrent((item) => item ? { ...item, error: error instanceof Error ? error.message : "Playback could not start." } : item);
    });
    else element.pause();
  }, [current, resolveAndPlay]);

  const seek = useCallback((seconds: number) => {
    const element = current?.source?.kind === "video" ? videoRef.current : audioRef.current;
    if (!element || !Number.isFinite(seconds)) return;
    element.currentTime = Math.max(0, Math.min(seconds, element.duration || seconds));
  }, [current?.source?.kind]);

  const setVolume = useCallback((value: number) => {
    const nextVolume = Math.max(0, Math.min(1, value));
    setVolumeState(nextVolume);
    if (audioRef.current) audioRef.current.volume = nextVolume;
    if (videoRef.current) videoRef.current.volume = nextVolume;
  }, []);

  const onPlay = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    if (replacingSourceRef.current || !isCurrentMediaElement(event.currentTarget)) return;
    setIsPlaying(true);
    if (current?.sessionId && !startedRef.current) {
      sendEvent(current.sessionId, "started", activeElement?.currentTime);
    } else if (current?.sessionId && playbackPausedRef.current) {
      sendEvent(current.sessionId, "resumed", activeElement?.currentTime);
    }
    startedRef.current = true;
    startedSessionRef.current = current?.sessionId ?? null;
    playbackPausedRef.current = false;
    lastProgressAtRef.current = Date.now();
  }, [activeElement, current?.sessionId, isCurrentMediaElement, sendEvent]);

  const onPause = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    if (replacingSourceRef.current || !isCurrentMediaElement(event.currentTarget)) return;
    setIsPlaying(false);
    const ended = Boolean(activeElement?.ended || (activeElement?.duration && activeElement.currentTime >= activeElement.duration - 0.25));
    if (current?.sessionId && startedSessionRef.current === current.sessionId && !ended) {
      playbackPausedRef.current = true;
      sendEvent(current.sessionId, "paused", activeElement?.currentTime);
    }
  }, [activeElement, current?.sessionId, isCurrentMediaElement, sendEvent]);

  const onTimeUpdate = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    const element = event.currentTarget;
    if (replacingSourceRef.current || !isCurrentMediaElement(element)) return;
    setCurrentTime(element.currentTime);
    if (Number.isFinite(element.duration)) setDuration(element.duration);
    if (current?.sessionId && startedSessionRef.current === current.sessionId && !element.paused && Date.now() - lastProgressAtRef.current >= 15_000) {
      lastProgressAtRef.current = Date.now();
      sendEvent(current.sessionId, "progress", element.currentTime);
    }
  }, [current?.sessionId, isCurrentMediaElement, sendEvent]);

  const onEnded = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    if (replacingSourceRef.current || !isCurrentMediaElement(event.currentTarget)) return;
    setIsPlaying(false);
    if (current?.sessionId) sendEvent(current.sessionId, "ended", activeElement?.currentTime);
    startedRef.current = false;
    startedSessionRef.current = null;
    playbackPausedRef.current = false;
    retryRequiredRef.current = true;
    if (upcomingRef.current.length) next();
  }, [activeElement, current?.sessionId, isCurrentMediaElement, next, sendEvent]);

  const onError = useCallback((event: SyntheticEvent<HTMLMediaElement>) => {
    if (replacingSourceRef.current || !isCurrentMediaElement(event.currentTarget)) return;
    const element = event.currentTarget;
    if (current?.sessionId) sendEvent(current.sessionId, "error", element?.currentTime, "media_error");
    startedRef.current = false;
    startedSessionRef.current = null;
    playbackPausedRef.current = false;
    retryRequiredRef.current = true;
    setCurrent((item) => item ? { ...item, error: "The media source could not be played." } : item);
  }, [current?.sessionId, isCurrentMediaElement, sendEvent]);

  useEffect(() => {
    if (current?.source?.kind !== "video") setVideoVisible(false);
  }, [current?.source?.kind]);

  useEffect(() => {
    if (!current || (!current.source && !current.loading)) replacingSourceRef.current = false;
  }, [current, current?.loading, current?.source]);

  useEffect(() => () => {
    const sessionId = currentRef.current?.sessionId;
    const element = currentRef.current?.source?.kind === "video" ? videoRef.current : audioRef.current;
    if (sessionId) void closeSessionRef.current(sessionId, element?.currentTime, "provider_unmounted");
  // The provider only unmounts when the authenticated shell closes.
  }, []);

  useEffect(() => {
    if (!current?.source || current.loading) return;
    replacingSourceRef.current = false;
    const element = current.source.kind === "video" ? videoRef.current : audioRef.current;
    if (!element) return;
    void element.play().catch(() => {
      setCurrent((item) => item ? { ...item, error: "Press play to start this media." } : item);
    });
  }, [current?.source, current?.loading]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  const value = useMemo<MediaPlayerContextValue>(() => ({
    current, upcoming, isPlaying, currentTime, duration, volume,
    playResource, enqueue, playUrl, toggle, seek, setVolume, next, previous, playQueued, removeFromQueue, clearQueue, clear,
  }), [current, upcoming, isPlaying, currentTime, duration, volume, playResource, enqueue, playUrl, toggle, seek, setVolume, next, previous, playQueued, removeFromQueue, clearQueue, clear]);

  return (
    <MediaPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        src={current?.source?.kind === "audio" ? current.source.url : undefined}
        preload="metadata"
        className="hidden"
        onPlaying={onPlay}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onTimeUpdate}
        onEnded={onEnded}
        onError={onError}
      />
      <video
        ref={videoRef}
        src={current?.source?.kind === "video" ? current.source.url : undefined}
        preload="metadata"
        playsInline
        className={videoVisible ? "fixed bottom-20 right-4 z-50 max-h-[38vh] max-w-[min(42vw,420px)] rounded-lg border border-white/20 bg-black shadow-xl" : "hidden"}
        onPlaying={onPlay}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onTimeUpdate}
        onEnded={onEnded}
        onError={onError}
      />
    </MediaPlayerContext.Provider>
  );
}
