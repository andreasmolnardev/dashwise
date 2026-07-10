"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import useAuth from "@/context/useAuth";
import {
    deleteMonitorAction,
    getMonitorAction,
    updateMonitoringStatusAction,
} from '@/lib/apiClient';
import type { MonitorPing, MonitorRecord } from "@dashwise/types/sdk";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import MonitoringTimeline from "@/components/monitoring/MonitoringTimeline";
import EditMonitorDialog from "@/components/monitoring/EditMonitorDialog";
import MonitorNotificationsDialog from "@/components/monitoring/MonitorNotificationsDialog";
import { useMonitoringLinkLookup } from "@/components/monitoring/useMonitoringLinkLookup";
import AppIcon from "@dashwise/app-icon";

type ParsedOutlier = {
    created: string;
    latencyMs: number;
    threshold?: { type: "absolute" | "relative"; value: number };
    baselineMs?: number;
    deltaMs?: number;
    deltaPercent?: number;
};

type StatusChangeEntry = {
    created: string;
    status: string;
    previousStatus: string;
    lastedMs: number;
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

function getMonitorUptime(pings: MonitorPing[], currentStatus?: string | null) {
    const sorted = [...pings].filter((ping) => ping.created).sort(
        (left, right) => {
            return new Date(String(left.created)).getTime() -
                new Date(String(right.created)).getTime();
        },
    );

    if (sorted.length === 0) {
        return currentStatus === "healthy" ? 100 : 0;
    }

    let totalMs = 0;
    let upMs = 0;

    for (let index = 0; index < sorted.length; index++) {
        const current = sorted[index];
        const next = sorted[index + 1];
        const start = new Date(String(current.created)).getTime();
        const end = next
            ? new Date(String(next.created)).getTime()
            : Date.now();
        const duration = Math.max(0, end - start);
        const isUp = String(current.status || "").toLowerCase() === "healthy";

        totalMs += duration;
        if (isUp) {
            upMs += duration;
        }
    }

    if (totalMs <= 0) {
        return currentStatus === "healthy" ? 100 : 0;
    }

    return Number(((upMs / totalMs) * 100).toFixed(2));
}

function buildStatusChanges(pings: MonitorPing[]): StatusChangeEntry[] {
    const sorted = [...pings].filter((ping) => ping.created).sort(
        (left, right) => {
            return new Date(String(left.created)).getTime() -
                new Date(String(right.created)).getTime();
        },
    );

    const entries: StatusChangeEntry[] = [];

    for (let index = 0; index < sorted.length; index++) {
        const current = sorted[index];
        const previous = sorted[index - 1];
        if (!current?.status || !current.created) continue;
        if (
            !previous?.status || previous.status === current.status ||
            !previous.created
        ) continue;

        const currentTime = new Date(String(current.created)).getTime();
        const previousTime = new Date(String(previous.created)).getTime();

        entries.push({
            created: String(current.created),
            status: String(current.status),
            previousStatus: String(previous.status),
            lastedMs: Math.max(0, currentTime - previousTime),
        });
    }

    return entries.reverse();
}

function getStatusColor(status?: string) {
    const normalized = String(status || "");
    if (normalized === "healthy") return "bg-emerald-400";
    if (normalized === "disabled") return "bg-slate-400";
    return "bg-rose-400";
}

function parsePingAvgLatency(raw: unknown) {
    if (!raw) return 0;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;

    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return Number(parsed?.avgMs ?? parsed?.value ?? 0) || 0;
        } catch {
            return Number(raw) || 0;
        }
    }

    if (typeof raw === "object") {
        return Number((raw as any).avgMs ?? (raw as any).value ?? 0) || 0;
    }

    return 0;
}

function formatThresholdLabel(outlier: ParsedOutlier) {
    const threshold = outlier.threshold;
    if (!threshold) {
        return outlier.deltaMs
            ? `${formatLatency(outlier.latencyMs)} measured (+${
                formatLatency(outlier.deltaMs)
            } from average)`
            : `${formatLatency(outlier.latencyMs)} measured`;
    }

    if (threshold.type === "relative") {
        return `${formatLatency(outlier.latencyMs)} measured (+${
            formatLatency(outlier.deltaMs ?? 0)
        } from average)`;
    }

    return `${formatLatency(outlier.latencyMs)} measured (+${
        formatLatency(outlier.deltaMs ?? 0)
    } from average)`;
}

function formatThresholdValue(outlier?: ParsedOutlier) {
    if (!outlier) return null;
    const threshold = outlier.threshold;
    if (!threshold) return null;
    if (threshold.type === "relative") {
        return `${Number(threshold.value).toFixed(2)}%`;
    }
    return `${Number(threshold.value).toFixed(0)} ms`;
}

export default function MonitoringDetailPage() {
    const { monitorId = "" } = useParams();
    const navigate = useNavigate();
    const { token, withAuth } = useAuth();
    const { entryById, loading: lookupLoading } = useMonitoringLinkLookup();
    const [monitor, setMonitor] = useState<MonitorRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [rechecking, setRechecking] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [visibleOutliers, setVisibleOutliers] = useState(4);
    const [visibleChanges, setVisibleChanges] = useState(4);

    useEffect(() => {
        if (!token || !monitorId) {
            setMonitor(null);
            setLoading(false);
            return;
        }

        let mounted = true;

        const loadMonitor = async () => {
            try {
                const data = await withAuth((auth) =>
                    getMonitorAction(auth, monitorId)
                );
                if (!mounted) return;
                setMonitor(data || null);
            } catch (err) {
                console.error("Failed to load monitor details:", err);
                if (mounted) {
                    setError("Unable to load monitor details.");
                    setMonitor(null);
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        loadMonitor();

        return () => {
            mounted = false;
        };
    }, [monitorId, token, withAuth]);

    const handleRecheck = async () => {
        if (!token || !monitorId || rechecking) return;
        setRechecking(true);
        try {
            await withAuth((auth) =>
                updateMonitoringStatusAction(auth, {
                    body: { jobId: monitorId },
                })
            );
            const data = await withAuth((auth) =>
                getMonitorAction(auth, monitorId)
            );
            if (data) setMonitor(data);
        } catch (err) {
            console.error("Failed to recheck monitor:", err);
        } finally {
            setRechecking(false);
        }
    };

    const linkEntry = monitor
        ? entryById.get(String(monitor.sourcelinkId || monitor.linkId || ""))
        : undefined;
    const pings = useMemo(() => parsePings(monitor?.pings), [monitor?.pings]);
    const latestPing = pings[pings.length - 1];
    const latestChangeDurationSeconds = useMemo(() => {
        if (pings.length < 2) return null;
        const current = pings[pings.length - 1];
        const previous = pings[pings.length - 2];
        if (!current?.created || !previous?.created) return null;

        const currentTime = new Date(String(current.created)).getTime();
        const previousTime = new Date(String(previous.created)).getTime();
        if (!Number.isFinite(currentTime) || !Number.isFinite(previousTime)) {
            return null;
        }

        return Math.max(0, (currentTime - previousTime) / 1000);
    }, [pings]);
    const lastChangeAt = latestPing?.created || monitor?.updated ||
        monitor?.created || null;
    const currentStatus = String(
        monitor?.status || latestPing?.status || "unknown",
    );
    const uptimeScore = useMemo(
        () => getMonitorUptime(pings, monitor?.status || latestPing?.status),
        [pings, monitor?.status, latestPing?.status],
    );
    const avgLatency = parsePingAvgLatency(monitor?.pingAvgLatency);
    const outliers = useMemo(() => {
        const parsed = parseOutliers(monitor?.pingOutliers);
        return [...parsed].sort((a, b) => {
            const aTime = a.created ? new Date(a.created).getTime() : 0;
            const bTime = b.created ? new Date(b.created).getTime() : 0;
            return bTime - aTime;
        });
    }, [monitor?.pingOutliers]);
    const statusChanges = useMemo(() => buildStatusChanges(pings), [pings]);

    useEffect(() => {
        setVisibleOutliers(4);
        setVisibleChanges(4);
    }, [monitorId]);

    if (!monitorId) {
        return (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h1 className="text-3xl font-semibold">
                    Monitor details
                </h1>
                <p className="mt-2 text-sm text-white/60">
                    No monitor was selected.
                </p>
            </div>
        );
    }

    if (loading || lookupLoading) {
        return (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm text-white/60">
                    Loading monitor details…
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm text-red-300">{error}</p>
            </div>
        );
    }

    if (!monitor) {
        return (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h1 className="text-3xl font-semibold">
                    Monitor not found
                </h1>
                <p className="mt-2 text-sm text-white/60">
                    The monitor may have been removed or you do not have
                    permission to view it.
                </p>
            </div>
        );
    }

    const monitorTitle = linkEntry?.title || monitor.endpoint ||
        monitor.sourcelinkId || monitor.source || monitor.id;
    const monitoredUrl = linkEntry?.url || monitor.endpoint || "Unknown";
    const method = String(monitor.method || "GET").toUpperCase();
    const changeLabel = formatStatusLabel(currentStatus);

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-3xl font-semibold text-balance">
                                    {monitorTitle}
                                </h1>
                                {linkEntry &&
                                        linkEntry.sourceType !== "home" &&
                                        linkEntry.collectionId
                                    ? (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                navigate(
                                                    `/links/lists/${linkEntry.collectionId}`,
                                                )}
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-transparent text-white/75 transition-colors hover:bg-white/10 hover:backdrop-blur-md hover:text-white"
                                            aria-label="Open parent collection"
                                            title="Open parent collection"
                                        >
                                            <Icon
                                                icon="fa6-solid:folder-open"
                                                className="text-sm"
                                            />
                                        </button>
                                    )
                                    : null}
                                {linkEntry?.url
                                    ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() =>
                                                // todo: follow user tan open behavior settings (new tab vs same tab)
                                                window.open(
                                                    linkEntry.url,
                                                    "_blank",
                                                    "noopener,noreferrer",
                                                )}
                                            aria-label="Open monitored URL"
                                            title="Open monitored URL"
                                            className="rounded-full p-2 h-min"
                                        >
                                            <Icon
                                                icon="fa6-solid:globe"
                                                className="text-sm"
                                            />
                                        </Button>
                                    )
                                    : null}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
                                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/90">
                                    {method}
                                </span>
                                <span className="max-w-full wrap-break-word text-sm text-white/70">
                                    {monitoredUrl}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-start lg:justify-end">
                    <button
                        type="button"
                        onClick={handleRecheck}
                        disabled={rechecking}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-transparent text-white/75 transition-colors hover:bg-white/10 hover:backdrop-blur-md hover:text-white disabled:opacity-50"
                        aria-label="Recheck now"
                        title="Recheck now"
                    >
                        <Icon
                            icon="fa6-solid:arrows-rotate"
                            className={`text-sm ${rechecking ? "animate-spin" : ""}`}
                        />
                    </button>

                    <button
                        type="button"
                        onClick={() => setEditOpen(true)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-transparent text-white/75 transition-colors hover:bg-white/10 hover:backdrop-blur-md hover:text-white"
                        aria-label="Edit monitor"
                        title="Edit monitor"
                    >
                        <Icon icon="fa6-solid:pen" className="text-sm" />
                    </button>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-transparent text-white/75 transition-colors hover:bg-white/10 hover:backdrop-blur-md hover:text-white"
                                aria-label="More actions"
                                title="More actions"
                            >
                                <Icon
                                    icon="fa6-solid:ellipsis-vertical"
                                    className="text-sm"
                                />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="min-w-48 text-foreground"
                        >
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={(event) => {
                                    event.preventDefault();
                                    if (
                                        !confirm(
                                            "Are you sure you want to delete this monitor?",
                                        )
                                    ) return;
                                    void (async () => {
                                        setDeleting(true);
                                        try {
                                            await withAuth((auth) =>
                                                deleteMonitorAction(
                                                    auth,
                                                    monitorId,
                                                )
                                            );
                                            navigate("/apps/monitoring");
                                        } catch (err) {
                                            console.error(
                                                "Failed to delete monitor:",
                                                err,
                                            );
                                            setError(
                                                "Failed to delete monitor",
                                            );
                                            setDeleting(false);
                                        }
                                    })();
                                }}
                                className="cursor-pointer"
                            >
                                <Icon
                                    icon="fa6-solid:trash"
                                    className="text-sm"
                                />
                                {deleting ? "Deleting..." : "Delete monitor"}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            <section className="frosted rounded-xl p-3 space-y-1">
                <div className="grid grid-cols-[1fr_auto]">
                    <div className="text-2xl font-semibold text-white">
                        <span
                            className={currentStatus === "healthy"
                                ? "text-emerald-300"
                                : currentStatus === "disabled"
                                ? "text-slate-300"
                                : "text-rose-300"}
                        >
                            {changeLabel}
                        </span>{" "}
                        since {formatTimestamp(lastChangeAt)}
                    </div>
                    <div className="text-2xl font-semibold text-white">
                        {uptimeScore.toFixed(2)}% Uptime
                    </div>
                </div>
                <span className="text-sm text-white/70">
                    Last checked at {formatTimestamp(monitor.updated)}
                </span>

                {/* timeline */}
                <MonitoringTimeline
                    status={monitor.status}
                    dateChanged={latestPing?.created ?? monitor.updated ??
                        monitor.created ?? null}
                    durationChanged={latestChangeDurationSeconds}
                    className="mt-2"
                />
            </section>
            <section className="frosted rounded-xl p-3 space-y-3">
                <div className="grid grid-cols-[auto_1fr] text-2xl font-semibold text-white">
                    Average response time
                    <span className="justify-self-end">
                        {formatLatency(avgLatency)}
                    </span>
                </div>
                {/* Outliers */}
                <h2 className="text-xl font-semibold m-0">
                    Outliers (+{formatThresholdValue(outliers[0]) ||
                        "No threshold"})
                </h2>

                {outliers.length === 0
                    ? (
                        <div className="py-2 text-sm text-white/60">
                            No response-time outliers have been recorded yet.
                        </div>
                    )
                    : (
                        <div className="space-y-0.5">
                            {outliers.slice(0, visibleOutliers).map(
                                (outlier, index) => {
                                    return (
                                        <div
                                            key={`${outlier.created}-${index}`}
                                            className="py-2"
                                        >
                                            <div className="text-base font-semibold text-white">
                                                {formatTimestamp(
                                                    outlier.created,
                                                )}
                                            </div>
                                            <div className="mt-1 text-sm text-white/65">
                                                {formatThresholdLabel(outlier)}
                                            </div>
                                        </div>
                                    );
                                },
                            )}

                            {outliers.length > visibleOutliers
                                ? (
                                    <div className="pt-1 flex w-full justify-center">
                                        <Button
                                            variant="ghost"
                                            onClick={() =>
                                                setVisibleOutliers((current) =>
                                                    current + 20
                                                )}
                                        >
                                            <AppIcon source="fa6-solid:chevron-down" />
                                            Show more outliers
                                        </Button>
                                    </div>
                                )
                                : null}
                        </div>
                    )}
            </section>
            <section className="frosted p-4 space-y-3 rounded-xl">
                {/* Status changes */}
                <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-semibold">
                        Status changes
                    </h2>
                    <button
                        type="button"
                        onClick={() => setNotificationsOpen(true)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-transparent text-white/75 transition-colors hover:bg-white/10 hover:backdrop-blur-md hover:text-white"
                        aria-label="Notification settings"
                        title="Notification settings"
                    >
                        <Icon icon="fa6-solid:bell" className="text-sm" />
                    </button>
                </div>

                {statusChanges.length === 0
                    ? (
                        <div className="py-2 text-sm text-white/60">
                            No status changes are available yet.
                        </div>
                    )
                    : (
                        <div className="space-y-1">
                            {statusChanges.slice(0, visibleChanges).map((
                                entry,
                                index,
                            ) => (
                                <div
                                    key={`${entry.created}-${index}`}
                                    className="group"
                                >
                                    <div className="text-base font-semibold text-white group-hover:text-primary">
                                        {formatStatusLabel(entry.status)}
                                    </div>
                                    <div className="text-sm text-white/65">
                                        {formatTimestamp(entry.created)} After
                                        {" "}
                                        {formatCompactDuration(entry.lastedMs)}
                                        {" "}
                                        of {formatStatusLabel(
                                            entry.previousStatus,
                                        )}
                                    </div>
                                </div>
                            ))}

                            {statusChanges.length > visibleChanges
                                ? (
                                    <div className="pt-1 flex w-full justify-center">
                                        <Button
                                            variant="ghost"
                                            onClick={() =>
                                                setVisibleChanges((current) =>
                                                    current + 20
                                                )}
                                        >
                                            <AppIcon source="fa6-solid:chevron-down" />
                                            Show more changes
                                        </Button>
                                    </div>
                                )
                                : null}
                        </div>
                    )}
            </section>

            <div className="spacer h-3"></div>

            <EditMonitorDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                monitor={monitor}
                onUpdated={(updated) => setMonitor(updated)}
            />

            <MonitorNotificationsDialog
                open={notificationsOpen}
                onOpenChange={setNotificationsOpen}
                monitor={monitor}
                onUpdated={(updated) => setMonitor(updated)}
            />
        </div>
    );
}
