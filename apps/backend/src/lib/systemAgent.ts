import {
  getAllSystemAgentHosts,
  getSystemAgentToken,
  getSystemAgentUrl,
  saveSystemAgentStats,
  type SystemAgentHostRecord,
  updateSystemAgentConnection,
} from "./data/monitoring";
import { createLogger } from "./logger";

type MonitoringEntry = Record<string, unknown>;
type LiveSubscriber = (entry: MonitoringEntry) => void;

const logger = createLogger("SystemAgent");
const reconnectDelayMs = 5_000;
const pollIntervalMs = Number(Bun.env.SYSTEM_AGENT_POLL_INTERVAL_MS) || 15_000;

function latestEntry(value: unknown): MonitoringEntry | null {
  if (Array.isArray(value)) return value.length ? latestEntry(value[value.length - 1]) : null;
  if (value && typeof value === "object") return value as MonitoringEntry;
  return null;
}

export class SystemAgentClient {
  private sockets = new Map<string, any>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private subscribers = new Map<string, Set<LiveSubscriber>>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  async start() {
    await this.refreshAll();
    this.pollTimer ??= setInterval(() => void this.refreshAll(), pollIntervalMs);
  }

  stop(hostId?: string) {
    if (hostId) {
      const socket = this.sockets.get(hostId);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      this.sockets.delete(hostId);
      const timer = this.reconnectTimers.get(hostId);
      if (timer) clearTimeout(timer);
      this.reconnectTimers.delete(hostId);
      return;
    }
    for (const id of this.sockets.keys()) this.stop(id);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async refreshAll() {
    const hosts = await getAllSystemAgentHosts().catch((error) => {
      logger.warn("Unable to load System Agent hosts", error);
      return [] as SystemAgentHostRecord[];
    });
    await Promise.all(hosts.map((host) => this.refresh(host)));
  }

  async refresh(host: SystemAgentHostRecord) {
    const token = getSystemAgentToken(host);
    if (!token) {
      await updateSystemAgentConnection(host.id, "offline").catch(() => undefined);
      return;
    }

    try {
      const [system, current] = await Promise.all([
        this.request(host, "/api/v1/system"),
        this.request(host, "/api/v1/metrics/latest"),
      ]);
      await updateSystemAgentConnection(host.id, "online", { ...host.systemInfo, agent: system });
      const entry = latestEntry(current);
      if (entry) await this.persist(host.id, entry, "http");
      this.connectLive(host);
    } catch (error) {
      await updateSystemAgentConnection(host.id, "offline").catch(() => undefined);
      logger.warn(`System Agent ${host.id} unavailable`, error instanceof Error ? error.message : String(error));
    }
  }

  async history(host: SystemAgentHostRecord, from?: string | null) {
    const params = new URLSearchParams({ resolution: "1m" });
    if (from) params.set("from", from);
    const path = `/api/v1/metrics/history?${params}`;
    return this.request(host, path);
  }

  subscribe(hostId: string, callback: LiveSubscriber) {
    const subscribers = this.subscribers.get(hostId) ?? new Set<LiveSubscriber>();
    subscribers.add(callback);
    this.subscribers.set(hostId, subscribers);
    return () => {
      subscribers.delete(callback);
      if (!subscribers.size) this.subscribers.delete(hostId);
    };
  }

  private async request(host: SystemAgentHostRecord, path: string): Promise<unknown> {
    const token = getSystemAgentToken(host);
    if (!token) throw new Error("System Agent token is missing");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(new URL(path, getSystemAgentUrl(host)), {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`System Agent returned HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private connectLive(host: SystemAgentHostRecord) {
    const liveUrl = host.systemInfo?.liveUrl;
    if (typeof liveUrl !== "string" || !liveUrl || this.sockets.has(host.id)) return;
    const token = getSystemAgentToken(host);
    if (!token) return;

    // Bun upgrade headers keep token out of URL and persisted stats.
    const socket = new (globalThis.WebSocket as any)(liveUrl, undefined, { headers: { Authorization: `Bearer ${token}` } });
    this.sockets.set(host.id, socket);
    socket.onmessage = (event: MessageEvent) => {
      try {
        const entry = latestEntry(JSON.parse(String(event.data)));
        if (entry) void this.persist(host.id, entry, "websocket");
      } catch {
        logger.warn(`System Agent ${host.id} sent invalid live data`);
      }
    };
    socket.onclose = () => {
      this.sockets.delete(host.id);
      this.scheduleReconnect(host);
    };
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(host: SystemAgentHostRecord) {
    if (this.reconnectTimers.has(host.id)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(host.id);
      void this.refresh(host);
    }, reconnectDelayMs);
    this.reconnectTimers.set(host.id, timer);
  }

  private async persist(hostId: string, entry: MonitoringEntry, source: "http" | "websocket") {
    const current = normalizeMetricEntry(entry);
    for (const subscriber of this.subscribers.get(hostId) ?? []) subscriber(current);
    // Live dashboard updates must not wait for (or be blocked by) PocketBase.
    // The stats record is only a cache for the non-live endpoint.
    try {
      await saveSystemAgentStats(hostId, { current, source, receivedAt: new Date().toISOString() });
    } catch (error) {
      logger.warn(
        `Unable to persist System Agent ${hostId} metrics`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function normalizeMetricEntry(entry: MonitoringEntry): MonitoringEntry {
  const timestamp = String(entry.timestamp || new Date().toISOString());
  const metrics = entry.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return { ...entry, timestamp };

  const values: Record<string, unknown> = {};
  for (const [name, summary] of Object.entries(metrics as Record<string, unknown>)) {
    values[name] = summary && typeof summary === "object" && "average" in summary
      ? (summary as { average: unknown }).average
      : summary;
  }
  return { timestamp, values, metrics };
}

export const systemAgentClient = new SystemAgentClient();
