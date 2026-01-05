"use client";

import React, { useEffect, useState } from "react";
import useAuth from "@/context/useAuth";
import WidgetColumnTemplate from "../templates/WidgetColumn";
import { WidgetItemProps } from "../Widget";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleInfo, faExclamation, faExclamationCircle, faInfo } from "@fortawesome/free-solid-svg-icons";
import { PaginatedCarouselViewComponent } from "../PaginatedCarouselView";

type HealthRecord = {
    system_name: string;
    health_score: number;
    biggest_minus?: string;
    details?: any;
    action?: string;
};

type HealthApiResponse = Record<string, HealthRecord>;

// --- Small circular ring indicator (SVG) ---
function CircularHealthIndicator({
    value,
    size = 52,
    stroke = 5,
}: {
    value: number;
    size?: number;
    stroke?: number;
}) {
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    const offset = circumference - (clamped / 100) * circumference;
    const display = clamped === 0 ? "Down" : `${clamped}%`;

    // Color thresholds (can be tuned)
    const getColor = (v: number) => {
        if (v >= 80) return "#16a34a"; // green
        if (v >= 60) return "#f59e0b"; // amber
        if (v >= 40) return "#f97316"; // orange
        return "#ef4444";
    };

    const color = getColor(clamped);

    return (
        <div
            className="inline-flex items-center justify-center"
            style={{ width: size, height: size }}
            aria-label={`Health ${clamped} percent`}
        >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <g transform={`translate(${size / 2}, ${size / 2})`}>
                    {/* background ring */}
                    <circle
                        r={radius}
                        fill="transparent"
                        stroke="rgba(255,255,255,0.06)"
                        strokeWidth={stroke}
                    />

                    {/* progress ring */}
                    <circle
                        r={radius}
                        fill="transparent"
                        stroke={color}
                        strokeWidth={stroke}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        style={{ transition: "stroke-dashoffset 600ms, stroke 300ms" }}
                        transform="rotate(-90)"
                    />
                </g>
            </svg>

            {/* centered label */}
            <div className="absolute text-sm font-semibold select-none">
                <span className="leading-none">{display}</span>
            </div>
        </div>
    );
}

// --- Card for a single system ---
function SystemCard({ record }: { record: HealthRecord }) {
    return (
        <a
            className="text-sm font-medium max-w-[160px] gap-1 group grid grid-cols-1 justify-items-center grid-rows-[auto auto] gap-1 p-1 w-full relative"
            title={record.system_name}
            href={record.action}
        >
            {record.biggest_minus &&
                !record.biggest_minus.toLowerCase().includes("no") && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="absolute top-0 right-1 rounded-full w-6 h-6 flex items-center justify-center">
                                {/* Transparent ring */}
                                <div className="absolute inset-0 rounded-full border-2 border-transparent bg-[rgba(0,0,0,0)] pointer-events-none"></div>

                                {/* Icon sits in the center */}
                                <FontAwesomeIcon
                                    icon={faExclamationCircle}
                                    className="relative z-10 text-(--text-on-frosted)"
                                />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>{record.biggest_minus}</TooltipContent>
                    </Tooltip>
                )}
            <CircularHealthIndicator value={record?.details?.status?.includes("down") ? 0 : record.health_score} />


            <span className="group-hover:text-(--primary)">{record.system_name}</span>
        </a>
    );
}

// --- Main widget component ---
export default function BeszelSystemHealthWidget({ className = "" }: WidgetItemProps) {
    const [data, setData] = useState<HealthApiResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { token } = useAuth();

    useEffect(() => {
        let mounted = true;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                if (!token) {
                    return;
                }
                const res = await fetch("/api/v1/integrations/beszel/system-healthstats", {
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const json = await res.json();
                if (mounted) setData(json || {});
                if (mounted) console.log(json);

            } catch (err: any) {
                if (mounted) setError(err?.message || "Failed to fetch");
            } finally {
                if (mounted) setLoading(false);
            }
        }

        load();

        return () => {
            mounted = false;
        };
    }, []);

    const items = data ? Object.values(data) : [];

    return (
        <WidgetColumnTemplate className={className} iconUrl="/icons/png/beszel-light.png" title="System health">
            {loading && <div className="col-span-full text-center text-sm">Loading…</div>}
            {error && <div className="col-span-full text-center text-sm text-red-400">{error}</div>}

            {!loading && items.length === 0 && <div className="col-span-full text-center text-sm">No systems found</div>}

            {!loading && items.length > 0 && (
                <PaginatedCarouselViewComponent minColWidth={32} maxRows={1}>
                    {items.map((rec, i) => (
                        <SystemCard record={rec} key={i} />
                    ))}
                </PaginatedCarouselViewComponent>
            )}

        </WidgetColumnTemplate>
    );
}
