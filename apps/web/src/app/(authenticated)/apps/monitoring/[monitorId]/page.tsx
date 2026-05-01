"use client";

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useAuth from "@/context/useAuth";
import { deleteMonitorAction, getMonitorAction, type MonitorRecord, type MonitorPing } from "@/app/actions/monitoring";

function parsePings(raw: any): MonitorPing[] {
    if (!raw) {
        return [];
    }

    if (Array.isArray(raw)) {
        return raw;
    }

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

function formatTimestamp(value: string | undefined | null) {
    if (!value) return "Unknown";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export default function MonitoringDetailPage() {
    const { monitorId = "" } = useParams();
    const navigate = useNavigate();
    const { token, withAuth } = useAuth();
    const [monitor, setMonitor] = useState<MonitorRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!token || !monitorId) {
            setMonitor(null);
            setLoading(false);
            return;
        }

        let mounted = true;

        const loadMonitor = async () => {
            try {
                const data = await withAuth((auth) => getMonitorAction(auth, monitorId));
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

    if (!monitorId) {
        return (
            <div className="rounded-3xl frosted border border-white/10 p-6">
                <h1 className="text-3xl font-semibold tracking-tight">Monitor details</h1>
                <p className="mt-2 text-sm text-white/60">No monitor was selected.</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="rounded-3xl frosted border border-white/10 p-6">
                <p className="text-sm text-white/60">Loading monitor details…</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-3xl frosted border border-white/10 p-6">
                <p className="text-sm text-red-300">{error}</p>
            </div>
        );
    }

    if (!monitor) {
        return (
            <div className="rounded-3xl frosted border border-white/10 p-6">
                <h1 className="text-3xl font-semibold tracking-tight">Monitor not found</h1>
                <p className="mt-2 text-sm text-white/60">The monitor may have been removed or you don’t have permission to view it.</p>
            </div>
        );
    }

    const pings = parsePings(monitor.pings);
    const latestPing = pings[pings.length - 1];

    return (
        <div className="space-y-6">
            <div className="rounded-3xl frosted border border-white/10 p-6 space-y-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight">
                            {monitor.endpoint || monitor.sourcelinkId || monitor.source || monitor.id}
                        </h1>
                        <p className="mt-2 text-sm text-white/60">
                            Monitor ID: {monitor.id}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-medium text-white/90">
                            <span className={
                                `mr-2 h-2.5 w-2.5 rounded-full ${
                                    monitor.status === "healthy"
                                        ? "bg-emerald-400"
                                        : monitor.status === "disabled"
                                            ? "bg-slate-400"
                                            : "bg-rose-400"
                                }`
                            } />
                            {monitor.status || "unknown"}
                        </div>
                        <button
                            onClick={async () => {
                                if (!confirm("Are you sure you want to delete this monitor?")) return;
                                setDeleting(true);
                                try {
                                    await withAuth((auth) => deleteMonitorAction(auth, monitorId));
                                    navigate("/apps/monitoring");
                                } catch (err) {
                                    console.error("Failed to delete monitor:", err);
                                    setError("Failed to delete monitor");
                                    setDeleting(false);
                                }
                            }}
                            disabled={deleting}
                            className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        >
                            {deleting ? "Deleting..." : "Delete"}
                        </button>
                    </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-white/40">Endpoint</p>
                        <p className="mt-2 text-sm text-white/80 break-words">{monitor.endpoint || "Unknown"}</p>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-white/40">Last changed</p>
                        <p className="mt-2 text-sm text-white/80">{formatTimestamp(latestPing?.created || monitor.updated || monitor.created)}</p>
                    </div>
                </div>
            </div>

            <div className="rounded-3xl frosted border border-white/10 p-6">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-semibold tracking-tight">Status history</h2>
                        <p className="mt-2 text-sm text-white/60">
                            Shows every status change recorded for this monitor.
                        </p>
                    </div>
                    <span className="rounded-full bg-white/5 px-3 py-1 text-sm text-white/80">
                        {pings.length} {pings.length === 1 ? "entry" : "entries"}
                    </span>
                </div>

                {pings.length === 0 ? (
                    <div className="mt-6 rounded-2xl bg-white/5 p-6 text-sm text-white/60">
                        No status history is available for this monitor yet.
                    </div>
                ) : (
                    <div className="mt-6 space-y-3">
                        {pings.map((ping, index) => (
                            <div
                                key={index}
                                className="rounded-2xl border border-white/10 bg-white/5 p-4"
                            >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-white/90">
                                            {ping.status || "unknown"}
                                        </p>
                                        <p className="text-xs text-white/50">
                                            {formatTimestamp(ping.created)}
                                        </p>
                                    </div>
                                    <div className="text-right text-sm text-white/60">
                                        {ping.httpStatus ? `HTTP ${ping.httpStatus}` : null}
                                        {ping.method ? ` · ${ping.method.toUpperCase()}` : null}
                                    </div>
                                </div>
                                {ping.endpoint ? (
                                    <p className="mt-3 text-sm text-white/60">{ping.endpoint}</p>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
