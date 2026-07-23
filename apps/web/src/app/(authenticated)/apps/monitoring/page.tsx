"use client";

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Icon } from "@iconify-icon/react";
import { getMonitorsAction } from "@/lib/apiClient";
import type { MonitorPing, MonitorRecord } from "@dashwise/types/sdk";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";

type ParsedOutlier = {
    created: string;
    latencyMs: number;
    threshold?: { type: "absolute" | "relative"; value: number };
    baselineMs?: number;
    deltaMs?: number;
};

type DowntimeEntry = {
    monitor: MonitorRecord;
    created: string;
    previousStatus: string;
    lastedMs: number;
};

type OutlierEntry = ParsedOutlier & {
    monitor: MonitorRecord;
};

function parsePings(raw: unknown): MonitorPing[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as MonitorPing[];

    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

function parseOutliers(raw: unknown): ParsedOutlier[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as ParsedOutlier[];

    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as ParsedOutlier[]) : [];
        } catch {
            return [];
        }
    }

    return [];
}

function formatTimestamp(value: string | undefined | null) {
    if (!value) return "Unknown";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatCompactDuration(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function formatLatency(ms?: number) {
    if (!Number.isFinite(Number(ms))) return "0 ms";
    return `${Number(ms).toFixed(2)} ms`;
}

function formatStatusLabel(status?: string) {
    const value = String(status || "unknown");
    if (value === "healthy") return "Up";
    if (value === "unhealthy") return "Down";
    if (value === "disabled") return "Disabled";
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function getMonitorTitle(monitor: MonitorRecord) {
    return monitor.endpoint || monitor.sourcelinkId || monitor.source || monitor.id;
}

function getCurrentStatus(monitor: MonitorRecord) {
    const pings = parsePings(monitor.pings);
    return String(monitor.status || pings[pings.length - 1]?.status || "unknown");
}

function buildDowntimes(monitors: MonitorRecord[]) {
    const entries: DowntimeEntry[] = [];

    for (const monitor of monitors) {
        const pings = parsePings(monitor.pings)
            .filter((ping) => ping.created)
            .sort((left, right) => {
                return new Date(String(left.created)).getTime() -
                    new Date(String(right.created)).getTime();
            });

        for (let index = 1; index < pings.length; index++) {
            const current = pings[index];
            const previous = pings[index - 1];
            if (!current?.status || current.status !== "healthy") continue;
            if (!previous?.status || previous.status === "healthy") continue;

            const currentTime = new Date(String(current.created)).getTime();
            const previousTime = new Date(String(previous.created)).getTime();

            entries.push({
                monitor,
                created: String(current.created),
                previousStatus: String(previous.status),
                lastedMs: Math.max(0, currentTime - previousTime),
            });
        }
    }

    return entries.sort((left, right) => {
        return new Date(right.created).getTime() - new Date(left.created).getTime();
    });
}

function buildOutliers(monitors: MonitorRecord[]) {
    const entries: OutlierEntry[] = [];

    for (const monitor of monitors) {
        for (const outlier of parseOutliers(monitor.pingOutliers)) {
            entries.push({ ...outlier, monitor });
        }
    }

    return entries.sort((left, right) => {
        return new Date(right.created).getTime() - new Date(left.created).getTime();
    });
}

export default function MonitoringHomePage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const monitorsQuery = useApiQuery(queryKeys.monitoring.monitors, getMonitorsAction);
    const monitors = (monitorsQuery.data ?? []) as MonitorRecord[];
    const loading = monitorsQuery.isLoading;
    const error = monitorsQuery.error ? "Unable to load monitoring overview." : null;

    const openMonitorDialog = () => {
        const next = new URLSearchParams(searchParams);
        next.set("newMonitor", "true");
        setSearchParams(next);
    };

    const summary = useMemo(() => {
        return monitors.reduce(
            (acc, monitor) => {
                const status = getCurrentStatus(monitor);
                if (status === "healthy") acc.up += 1;
                else if (status === "disabled") acc.disabled += 1;
                else acc.down += 1;
                return acc;
            },
            { up: 0, down: 0, disabled: 0 },
        );
    }, [monitors]);
    const downtimes = useMemo(() => buildDowntimes(monitors), [monitors]);
    const outliers = useMemo(() => buildOutliers(monitors), [monitors]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <h1 className="text-3xl font-semibold tracking-tight">
                    Overview
                </h1>

                <Button onClick={openMonitorDialog} className="gap-2">
                    <Icon icon="fa6-solid:plus" className="text-xs" />
                    Add Monitor
                </Button>
            </div>

            {error ? (
                <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                    {error}
                </div>
            ) : null}

            <section className="frosted rounded-xl p-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                    <div>
                        <div className="text-sm text-white/60">Monitors up</div>
                        <div className="text-3xl font-semibold text-emerald-300">
                            {summary.up}
                        </div>
                    </div>
                    <div>
                        <div className="text-sm text-white/60">Monitors down</div>
                        <div className="text-3xl font-semibold text-rose-300">
                            {summary.down}
                        </div>
                    </div>
                    <div>
                        <div className="text-sm text-white/60">Disabled</div>
                        <div className="text-3xl font-semibold text-slate-300">
                            {summary.disabled}
                        </div>
                    </div>
                </div>
                <span className="text-sm text-white/70">
                    {loading ? "Loading monitors..." : `Total ${monitors.length} monitors`}
                </span>
            </section>

            <section className="frosted p-4 space-y-3 rounded-xl">
                <h2 className="text-2xl font-semibold">Latest Downtimes</h2>
                {downtimes.length === 0 ? (
                    <div className="py-2 text-sm text-white/60">
                        No downtime recoveries are available yet.
                    </div>
                ) : (
                    <div className="space-y-1">
                        {downtimes.slice(0, 6).map((entry, index) => (
                            <div key={`${entry.monitor.id}-${entry.created}-${index}`} className="group">
                                <div className="text-base font-semibold text-white group-hover:text-primary">
                                    {getMonitorTitle(entry.monitor)} recovered
                                </div>
                                <div className="text-sm text-white/65">
                                    {formatTimestamp(entry.created)} after {formatCompactDuration(entry.lastedMs)} of {formatStatusLabel(entry.previousStatus)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="frosted rounded-xl p-3 space-y-3">
                <h2 className="text-2xl font-semibold">Latest Ping Outliers</h2>
                {outliers.length === 0 ? (
                    <div className="py-2 text-sm text-white/60">
                        No response-time outliers have been recorded yet.
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {outliers.slice(0, 6).map((outlier, index) => (
                            <div key={`${outlier.monitor.id}-${outlier.created}-${index}`} className="py-2">
                                <div className="text-base font-semibold text-white">
                                    {getMonitorTitle(outlier.monitor)}
                                </div>
                                <div className="mt-1 text-sm text-white/65">
                                    {formatTimestamp(outlier.created)} - {formatLatency(outlier.latencyMs)} measured
                                    {outlier.deltaMs ? ` (+${formatLatency(outlier.deltaMs)} from average)` : ""}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
