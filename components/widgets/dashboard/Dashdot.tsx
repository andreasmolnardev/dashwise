"use client";

import React, { useEffect, useState, useMemo } from "react";
import useAuth from "@/context/useAuth";
import WidgetColumnTemplate from "../templates/WidgetColumn";
import type { WidgetItemProps } from "../Widget";

interface DashdotWidgetParams {
    defaultOverride?: boolean | null;
    serverLocation?: string | null;
    serverDisplayname?: string | null;
}

export type DashdotWidgetProps = WidgetItemProps & {
    params?: DashdotWidgetParams;
};

export default function DashdotWidget({ params, className = "" }: DashdotWidgetProps & { className?: string }) {
    const [metrics, setMetrics] = useState<any | null>(null);
    const [serverDetails, setServerDetails] = useState<{ url?: string; displayName?: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // fetch logic
    const { token } = useAuth();

    const fetchMetrics = async () => {
        setLoading(true);
        setError(null);
        try {
            if (!token) {
                return;
            }
            const url = "/api/v1/integrations/dashdot";
            const useOverride = !!params?.defaultOverride;
            const body = useOverride
                ? { serverUrl: params?.serverLocation, displayName: params?.serverDisplayname }
                : undefined;

            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                ...({ body: JSON.stringify(body) }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setMetrics(json.metrics);
            setServerDetails(json.serverDetails);
        } catch (err: any) {
            console.error(err);
            setError(err?.message ?? "Failed to fetch");
            setMetrics(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMetrics();
        const id = setInterval(fetchMetrics, 8000);
        return () => clearInterval(id);
    }, [params?.defaultOverride, params?.serverLocation, params?.serverDisplayname]);

    // helpers
    const humanBytes = (bytes: number | undefined | null) => {
        if (bytes == null || isNaN(bytes)) return "—";
        const units = ["B", "KB", "MB", "GB", "TB"];
        let i = 0;
        let n = Math.abs(bytes);
        while (n >= 1024 && i < units.length - 1) {
            n /= 1024;
            i++;
        }
        return `${n.toFixed(1)} ${units[i]}`;
    };

    const avgCoreLoad = (cpu: any) => {
        if (!cpu?.load?.length) return 0;
        const values = cpu.load.map((c: any) => c.load ?? 0);
        return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    };

    const hasGpu = useMemo(() => {
        if (!metrics?.gpu) return false;
        const layout = metrics.gpu.layout ?? [];
        const load = metrics.gpu.load;
        return layout.length > 0 || (load != null && !isNaN(load));
    }, [metrics]);

    const items = [
        {
            type: "CPU",
            primary: metrics?.cpu ? `${avgCoreLoad(metrics.cpu)}%` : "—",
            secondary: metrics?.cpu ? `${metrics.cpu.cores} cores` : "—",
        },
        {
            type: "Memory",
            primary: metrics?.memory
                ? humanBytes(metrics.memory.load?.load ?? metrics.memory.load)
                : "—",
            secondary:
                metrics?.memory?.total
                    ? `of ${humanBytes(metrics.memory.total)} used(${Math.round(
                        ((metrics.memory.load?.load ?? metrics.memory.load) /
                            metrics.memory.total) *
                        100
                    )}%)`
                    : "—",
        },
        hasGpu
            ? {
                type: "GPU",
                primary: metrics?.gpu?.load != null ? `${metrics.gpu.load}%` : "—",
                secondary:
                    metrics?.gpu?.layout?.length
                        ? metrics.gpu.layout.map((g: any) => g.name).join(", ")
                        : "—",
            }
            : {
                type: "Storage",
                primary:
                    metrics?.storage?.length && metrics.storage[0].load >= 0
                        ? `${Math.round(metrics.storage[0].usedPercentage)}%`
                        : "—",
                secondary:
                    metrics?.storage?.length
                        ? metrics.storage.map((s: any) => humanBytes(s.total)).join(" / ")
                        : "—",
            },
    ];

    // render columns
    return (
        <WidgetColumnTemplate className={className} title={serverDetails?.displayName} iconUrl="/icons/png/dashdot.png" url={serverDetails?.url}>
            {items.map((item, i) => (
                <div key={i} className="grid grid-rows-[20%_1fr_30%] items-center text-center">
                    <div className="text-xs font-medium">{item.type}</div>

                    <div className="text-2xl whitespace-nowrap">
                        {item.primary}
                    </div>

                    <div className="text-xs text-[var(--text-on-frosted)]">
                        {item.secondary}
                    </div>
                </div>
            ))}
        </WidgetColumnTemplate>

    );
}
