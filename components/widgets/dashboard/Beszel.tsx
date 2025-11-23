import React, { useEffect, useState } from "react";
import WidgetColumnTemplate from "../templates/WidgetColumn";
import { WidgetItemProps } from "../Widget";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleInfo, faExclamation, faExclamationCircle, faInfo } from "@fortawesome/free-solid-svg-icons";

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
    const shortMsg = record.biggest_minus || "No issues";
    const showTooltip = !!record.biggest_minus && record.biggest_minus.length > 30;

    return (
        <div className="flex flex-col items-center gap-1 p-1 w-full relative">

            {record.biggest_minus &&
                !record.biggest_minus.toLowerCase().includes("no") && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <FontAwesomeIcon
                                icon={faExclamationCircle}
                                className="absolute top-0.5 right-0.5 text-(--text-on-frosted)"
                            />
                        </TooltipTrigger>
                        <TooltipContent>{record.biggest_minus}</TooltipContent>
                    </Tooltip>
                )}
            <CircularHealthIndicator value={record?.details?.status?.includes("down") ? 0 : record.health_score} />

            <div
                className="text-sm font-medium max-w-[160px] inline-flex items-center gap-1"
                title={record.system_name}
            >
                <span>{record.system_name}</span>
            </div>
        </div>
    );
}

// --- Main widget component ---
export default function BeszelSystemHealthWidget({ className = "" }: WidgetItemProps) {
    const [data, setData] = useState<HealthApiResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const token = localStorage.getItem("pb_token");
                if (!token) {
                    return;
                }
                const res = await fetch("/api/v1/integrations/beszel/system-healthstats", {
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const json = await res.json();
                if (mounted) setData(json || {});
            } catch (err: any) {
                if (mounted) setError(err?.message || "Failed to fetch");
            } finally {
                if (mounted) setLoading(false);
            }
        }

        load();

        // optionally: refresh every 30s (commented out — enable if desired)
        // const id = setInterval(load, 30000);
        // return () => { mounted = false; clearInterval(id); };

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

            {items.map((rec, i) => (
                <div key={i} className="flex items-center justify-center">
                    <SystemCard record={rec} />
                </div>
            ))}
        </WidgetColumnTemplate>
    );
}
