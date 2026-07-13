"use client";

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import AppIcon from "@dashwise/app-icon";
import useAuth from "@/context/useAuth";
import {
  getMonitoringHostsAction,
  type MonitoringHostRecord,
} from "@/lib/apiClient";
import {
  type HostMetricRecord,
  useMonitoringHostMetrics,
} from "@/components/monitoring/useMonitoringHostMetrics";

function valueAt(value: Record<string, unknown>, path: string): unknown {
  if (path in value) return value[path];
  return path.split(".").reduce<unknown>(
    (current, key) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  );
}

function numberAt(record: HostMetricRecord, paths: string[]) {
  for (const path of paths) {
    const value = valueAt(record.values, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function MetricCard(
  { title, value, suffix, records, paths, color = "#5eead4" }: {
    title: string;
    value: string;
    suffix?: string;
    records: HostMetricRecord[];
    paths: string[];
    color?: string;
  },
) {
  const points = records.slice(-120).map((record) => numberAt(record, paths));
  const max = Math.max(...points, 1);
  const graph = points.map((point, index) =>
    `${(index / Math.max(points.length - 1, 1)) * 100},${
      34 - (point / max) * 30
    }`
  ).join(" ");
  return (
    <section className="frosted rounded-xl p-4 shadow-sm min-h-40">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm text-white/65">{title}</h2>
        <span className="font-mono text-lg tabular-nums">
          {value}
          {suffix && (
            <small className="ml-1 text-xs text-white/55">{suffix}</small>
          )}
        </span>
      </div>
      <svg
        className="mt-5 h-16 w-full overflow-visible"
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title} history`}
      >
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          points={graph}
        />
      </svg>
    </section>
  );
}

function Containers({ containers }: { containers: Record<string, unknown>[] }) {
  const [filter, setFilter] = useState("");
  const visible = containers.filter((container) =>
    String(container.name || container.names || container.id || "")
      .toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <section className="frosted rounded-xl p-4 shadow-sm overflow-hidden">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-medium">
          All containers{" "}
          <span className="text-sm font-normal text-white/50">
            {containers.length}
          </span>
        </h2>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="filter containers"
          className="h-9 rounded-lg border border-white/15 bg-black/20 px-3 text-sm outline-none placeholder:text-white/40 focus:border-cyan-300/60"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-white/10 text-xs text-white/50">
            <tr>
              <th className="pb-2 font-medium">name</th>
              <th className="pb-2 font-medium">status</th>
              <th className="pb-2 font-medium">cpu</th>
              <th className="pb-2 font-medium">memory</th>
              <th className="pb-2 font-medium">network</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((container, index) => (
              <tr
                key={String(container.id || container.name || index)}
                className="border-b border-white/5 last:border-0"
              >
                <td className="py-3 font-medium">
                  {String(
                    container.name || container.names || container.id ||
                      "container",
                  )}
                </td>
                <td className="py-3 text-white/65">
                  {String(container.status || container.state || "-")}
                </td>
                <td className="py-3 font-mono">
                  {Number(container.cpuPercent || container.cpu || 0).toFixed(
                    1,
                  )}%
                </td>
                <td className="py-3 font-mono">
                  {formatBytes(
                    Number(container.memoryUsage || container.memory || 0),
                  )}
                </td>
                <td className="py-3 font-mono">
                  {formatBytes(
                    Number(container.networkRx || container.network || 0),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function MonitoringHostPage() {
  const { hostId } = useParams();
  const { token, withAuth } = useAuth();
  const [host, setHost] = useState<MonitoringHostRecord | null>(null);
  const { records, live, error } = useMonitoringHostMetrics(hostId);
  useEffect(() => {
    if (!token || !hostId) {
      setHost(null);
      return;
    }
    void withAuth((auth) => getMonitoringHostsAction(auth)).then((hosts) =>
      setHost(hosts.find((item) => item.id === hostId) ?? null)
    ).catch(() => setHost(null));
  }, [hostId, token, withAuth]);
  const latest = records.at(-1);
  const info = host?.systemInfo || {};
  const agentInfo = info.agent && typeof info.agent === "object"
    ? info.agent as Record<string, unknown>
    : info;
  const drives = Array.isArray(valueAt(latest?.values || {}, "drives"))
    ? valueAt(latest?.values || {}, "drives") as Record<string, unknown>[]
    : [];
  const containers = Array.isArray(valueAt(latest?.values || {}, "containers"))
    ? valueAt(latest?.values || {}, "containers") as Record<string, unknown>[]
    : [];
  const cpu = latest
    ? numberAt(latest, ["cpu.percent", "cpu.usage", "cpu"])
    : 0;
  const memory = latest
    ? numberAt(latest, [
      "memory.usage_percent",
      "memory.percent",
      "memory.usagePercent",
    ])
    : 0;
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{host?.name || "Host"}</h1>
          <p className="mt-1 text-sm text-white/55">
            {host?.hostname || "Loading host details"}
          </p>
        </div>
        <span
          className={`flex items-center gap-2 text-sm ${
            live ? "text-emerald-300" : "text-white/50"
          }`}
        >
          <i
            className={`h-2 w-2 rounded-full ${
              live ? "bg-emerald-400" : "bg-white/35"
            }`}
          />
          {live ? "live" : "reconnecting"}
        </span>
      </header>
      <section className="frosted rounded-xl px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>
            <AppIcon source="fa6-solid:server" className="mr-2 text-cyan-200" />
            {String(
              agentInfo.os || agentInfo.platform ||
                "system information unavailable",
            )}
          </span>
          <span className="text-white/60">
            {String(agentInfo.kernel || "")}
          </span>
          <span className="text-white/60">
            uptime {String(agentInfo.uptime_seconds || agentInfo.uptime || "-")}
          </span>
          <span className="text-white/60">
            {String(
              agentInfo.cpu_model || agentInfo.cpuModel || agentInfo.cpu || "",
            )}
          </span>
        </div>
      </section>
      {error && <p className="text-sm text-amber-200">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          title="CPU Usage"
          value={cpu.toFixed(1)}
          suffix="%"
          records={records}
          paths={["cpu.percent", "cpu.usage", "cpu"]}
        />
        <MetricCard
          title="Docker CPU"
          value={(latest
            ? numberAt(latest, ["docker.cpu.percent", "docker.cpu"])
            : 0).toFixed(1)}
          suffix="%"
          records={records}
          paths={["docker.cpu.percent", "docker.cpu"]}
          color="#a78bfa"
        />
        <MetricCard
          title="Memory Usage"
          value={memory.toFixed(1)}
          suffix="%"
          records={records}
          paths={[
            "memory.usage_percent",
            "memory.percent",
            "memory.usagePercent",
          ]}
        />
        <MetricCard
          title="Docker memory"
          value={(latest
            ? numberAt(latest, ["docker.memory.percent", "docker.memory"])
            : 0).toFixed(1)}
          suffix="%"
          records={records}
          paths={["docker.memory.percent", "docker.memory"]}
          color="#a78bfa"
        />
        <MetricCard
          title="Disk Usage"
          value={(latest
            ? numberAt(latest, [
              "disk.usage_percent",
              "disk.percent",
              "disk.usagePercent",
            ])
            : 0).toFixed(1)}
          suffix="%"
          records={records}
          paths={["disk.usage_percent", "disk.percent", "disk.usagePercent"]}
        />
        <MetricCard
          title="Disk I/O"
          value={formatBytes(
            latest
              ? numberAt(latest, [
                "disk.write_bytes_per_second",
                "disk.io",
                "disk.writeBytes",
              ])
              : 0,
          )}
          records={records}
          paths={[
            "disk.read_bytes_per_second",
            "disk.write_bytes_per_second",
            "disk.io",
            "disk.writeBytes",
          ]}
          color="#fbbf24"
        />
        <MetricCard
          title="Bandwidth"
          value={formatBytes(
            latest
              ? numberAt(latest, [
                "network.received_bytes_per_second",
                "network.rx",
                "network.bytesIn",
              ])
              : 0,
          )}
          records={records}
          paths={[
            "network.sent_bytes_per_second",
            "network.received_bytes_per_second",
            "network.rx",
            "network.bytesIn",
          ]}
        />
        <MetricCard
          title="Docker network"
          value={formatBytes(
            latest
              ? numberAt(latest, [
                "docker.network.rx",
                "docker.network.bytesIn",
              ])
              : 0,
          )}
          records={records}
          paths={["docker.network.rx", "docker.network.bytesIn"]}
          color="#a78bfa"
        />
        <MetricCard
          title="Load Average"
          value={(latest ? numberAt(latest, ["load.one", "load.1m"]) : 0)
            .toFixed(2)}
          records={records}
          paths={["load.one", "load.1m"]}
        />
        <MetricCard
          title="Temperature"
          value={(latest
            ? numberAt(latest, ["temperature.celsius", "temperature"])
            : 0).toFixed(1)}
          suffix="C"
          records={records}
          paths={["temperature.celsius", "temperature"]}
          color="#fb7185"
        />
      </div>
      {drives.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {drives.map((drive, index) => (
            <MetricCard
              key={String(drive.mount || drive.name || index)}
              title={`${String(drive.mount || drive.name || "Drive")} usage`}
              value={Number(drive.percent || drive.usagePercent || 0).toFixed(
                1,
              )}
              suffix="%"
              records={records}
              paths={[
                `drives.${index}.percent`,
                `drives.${index}.usagePercent`,
              ]}
            />
          ))}
          {drives.map((drive, index) => (
            <MetricCard
              key={`${String(drive.mount || drive.name || index)}-io`}
              title={`${String(drive.mount || drive.name || "Drive")} IO`}
              value={formatBytes(Number(drive.io || drive.writeBytes || 0))}
              records={records}
              paths={[`drives.${index}.io`, `drives.${index}.writeBytes`]}
              color="#fbbf24"
            />
          ))}
        </section>
      )}
      <Containers containers={containers} />
    </div>
  );
}
