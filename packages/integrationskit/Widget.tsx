"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    resolveWidgetProperties,
    resolveWidgetRuntimeData,
} from "./data/resolveProperties";
import { renderLocalizedText, type TextFormatters } from "./data/renderText";
import WidgetColumnTemplate from "./templates/WidgetColumn";
import VerticalList from "./templates/VerticalList";
import ItemDetailsCard from "./templates/ItemDetailsCard";
import IframeTemplate from "./templates/IFrame";
import AppIcon from "@dashwise/app-icon";
import type { ResolvedWidget } from "./types";

export type WidgetProps = {
    widgetKey: string;
    integrationJSON?: Record<string, any> | null; // will also be used as fallback
    widgetJSON?: Record<string, any> | null;
    input?: Record<string, any> | null;
    data?: Record<string, any> | null;
    resolved?: ResolvedWidget | null;
    formatters?: TextFormatters; // provide localization
    isPreview?: boolean;
    className?: string;
};

export default function Widget({
    widgetKey,
    integrationJSON,
    widgetJSON,
    input,
    data,
    resolved: preResolved,
    formatters,
    isPreview = false,
    className,
}: WidgetProps) {
    const [resolved, setResolved] = useState<ResolvedWidget | null>(null);
    const [resolutionError, setResolutionError] = useState<string | null>(null);
    const [isResolving, setIsResolving] = useState(true);
    const effectiveWidgetJSON = widgetJSON ??
        integrationJSON?.widgets?.find(
            (w: Record<string, any>) => w.key === widgetKey,
        ) ??
        null;

    const widgetWithInput = useMemo(
        () =>
            effectiveWidgetJSON
                ? applyWidgetInput(effectiveWidgetJSON, input)
                : null,
        [effectiveWidgetJSON, input],
    );

    useEffect(() => {
        let cancelled = false;

        if (preResolved) {
            setResolved(preResolved);
            setResolutionError(null);
            setIsResolving(false);
            return () => {
                cancelled = true;
            };
        }

        async function runResolution() {
            if (!effectiveWidgetJSON || !widgetWithInput) {
                if (!cancelled) {
                    setResolved(null);
                    setResolutionError(null);
                    setIsResolving(false);
                }
                return;
            }

            if (!cancelled) {
                setResolutionError(null);
                setIsResolving(true);
            }

            if (isPreview) {
                if (!cancelled) {
                    setResolved(resolveWidgetProperties({
                        widgetJSON: widgetWithInput,
                        integrationJSON: integrationJSON ?? null,
                        data: null,
                        isPreview: isPreview,
                    }));
                    setIsResolving(false);
                }
                return;
            }

            try {
                const runtimeData = data !== undefined
                    ? data
                    : integrationJSON
                    ? (await resolveWidgetRuntimeData({
                        widgetJSON: widgetWithInput,
                        integrationJSON: integrationJSON ?? null,
                        data: null,
                        isPreview: isPreview,
                    })).data
                    : null;
                console.log("Resolved widget runtime data:", runtimeData);
                if (!cancelled) {
                    setResolved(
                        resolveWidgetProperties({
                            widgetJSON: widgetWithInput,
                            integrationJSON: integrationJSON ?? null,
                            data: runtimeData,
                            isPreview: isPreview,
                        }),
                    );
                    setIsResolving(false);
                }
            } catch (error) {
                if (!cancelled) {
                    setResolved(null);
                    setResolutionError(
                        error instanceof Error ? error.message : String(error),
                    );
                    setIsResolving(false);
                }
            }
        }

        void runResolution();

        return () => {
            cancelled = true;
        };
    }, [
        data,
        effectiveWidgetJSON,
        integrationJSON,
        isPreview,
        preResolved,
        widgetWithInput,
    ]);

    if (!effectiveWidgetJSON) {
        console.warn(
            `Widget definition for key "${widgetKey}" not found in integration JSON. Rendering empty widget.`,
        );
        return <div className={`frosted rounded-xl ${className ?? ""}`} />;
    }

    if (isResolving && !preResolved) {
        return (
            <WidgetLoadingState
                className={className}
                label={resolveWidgetLabel(widgetKey, integrationJSON)}
            />
        );
    }

    if (resolutionError && !isPreview) {
        return (
            <WidgetErrorState
                className={className}
                message={resolutionError}
            />
        );
    }

    if (!resolved) {
        return (
            <WidgetLoadingState
                className={className}
                label={resolveWidgetLabel(widgetKey, integrationJSON)}
            />
        );
    }

    const template = effectiveWidgetJSON.template ?? "columns";
    const renderedResolved = applyResolvedColumnCustomizations(
        resolved,
        input,
    );

    switch (template) {
        case "columns":
            return (
                <ColumnsWidget
                    resolved={renderedResolved}
                    className={className}
                    formatters={formatters}
                />
            );

        case "vertical-list":
            return (
                <VerticalList
                    resolved={renderedResolved}
                    className={className}
                    formatters={formatters}
                />
            );

        case "icon-details-card":
            return (
                <ItemDetailsCard
                    resolved={renderedResolved}
                    className={className}
                    formatters={formatters}
                />
            );

        default:
            return null;
    }
}

function WidgetErrorState({
    className,
    message,
}: {
    className?: string;
    message: string;
}) {
    return (
        <div
            className={`frosted rounded-xl border border-red-500/30 bg-red-500/10 p-3 ${
                className ?? ""
            }`}
        >
            <p className="text-sm font-semibold text-red-200">
                Widget failed to load
            </p>
            <p className="mt-1 text-xs leading-snug text-red-100/80 wrap-break-word max-h-10 overflow-x-scroll">
                {message}
            </p>
        </div>
    );
}

function WidgetLoadingState({
    className,
    label,
}: {
    className?: string;
    label?: string;
}) {
    return (
        <div
            className={`frosted rounded-xl border border-white/10 bg-white/5 p-3 ${
                className ?? ""
            }`}
            aria-busy="true"
            aria-live="polite"
        >
            <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-pulse rounded-full bg-white/20" />
                <div className="h-3 w-24 animate-pulse rounded-full bg-white/15" />
            </div>

            {label
                ? (
                    <p className="mt-2 text-xs text-white/50">
                        Loading widget from {label}...
                    </p>
                )
                : null}

            <div className="mt-3 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded-full bg-white/15" />
                <div className="h-3 w-1/2 animate-pulse rounded-full bg-white/10" />
                <div className="h-3 w-5/6 animate-pulse rounded-full bg-white/10" />
            </div>
        </div>
    );
}

function resolveWidgetLabel(
    widgetKey: string,
    integrationJSON?: Record<string, any> | null,
) {
    const integrationDetails = integrationJSON?.integration?.details;
    const integrationName =
        (integrationDetails && typeof integrationDetails.name === "string" &&
                integrationDetails.name.trim())
            ? integrationDetails.name.trim()
            : (integrationJSON?.details &&
                    typeof integrationJSON.details.name === "string" &&
                    integrationJSON.details.name.trim())
            ? integrationJSON.details.name.trim()
            : (integrationJSON?.integration &&
                    typeof integrationJSON.integration.name === "string" &&
                    integrationJSON.integration.name.trim())
            ? integrationJSON.integration.name.trim()
            : (integrationJSON && typeof integrationJSON.name === "string" &&
                    integrationJSON.name.trim())
            ? integrationJSON.name.trim()
            : "";

    return integrationName || widgetKey;
}

function applyWidgetInput(
    widgetJSON: Record<string, any>,
    input: Record<string, any> | null | undefined,
) {
    if (!input || typeof input !== "object") {
        return widgetJSON;
    }

    return {
        ...widgetJSON,
        data: {
            ...(widgetJSON?.data ?? {}),
            input: {
                ...((widgetJSON?.data?.input ?? {}) as Record<string, any>),
                ...input,
            },
        },
    };
}

function applyResolvedColumnCustomizations(
    resolved: ResolvedWidget,
    input: Record<string, any> | null | undefined,
): ResolvedWidget {
    if (!resolved.columns || resolved.columns.length === 0) {
        return resolved;
    }

    const displayCustomizations = input?.display_customizations;
    const orderIds = Array.isArray(displayCustomizations?.order)
        ? displayCustomizations.order.filter((
            value: unknown,
        ): value is string => typeof value === "string")
        : [];
    const hiddenIds = Array.isArray(displayCustomizations?.hidden)
        ? displayCustomizations.hidden.filter((
            value: unknown,
        ): value is string => typeof value === "string")
        : [];

    if (orderIds.length === 0 && hiddenIds.length === 0) {
        return resolved;
    }

    const visibleColumns = hiddenIds.length > 0
        ? resolved.columns.filter((column) => !hiddenIds.includes(column.id))
        : [...resolved.columns];

    if (orderIds.length === 0) {
        return {
            ...resolved,
            columns: visibleColumns,
        };
    }

    const byId = new Map(
        visibleColumns.map((column) => [column.id, column] as const),
    );
    const ordered = orderIds
        .map((id: string) => byId.get(id))
        .filter((
            column: NonNullable<ResolvedWidget["columns"]>[number] | undefined,
        ): column is NonNullable<ResolvedWidget["columns"]>[number] =>
            Boolean(column)
        );
    const remaining = visibleColumns.filter((column) =>
        !orderIds.includes(column.id)
    );

    return {
        ...resolved,
        columns: [...ordered, ...remaining],
    };
}

// ── Columns wrapper ────────────────────────────────────────────────────────────
// Bridges ResolvedWidget → WidgetColumnTemplate's children-based API

function ColumnsWidget({
    resolved,
    className,
    formatters,
}: {
    resolved: ResolvedWidget;
    className?: string;
    formatters?: TextFormatters;
}) {
    const header = resolved.header;
    const columns = resolved.columns ?? [];

    return (
        <WidgetColumnTemplate
            className={className}
            title={header?.show !== false
                ? renderLocalizedText(header?.title ?? "", formatters)
                : ""}
            url={header?.titleAction ?? ""}
            iconUrl={header?.icon ?? ""}
        >
            {columns.map((col) => (
                <ColumnCell key={col.id} col={col} formatters={formatters} />
            ))}
        </WidgetColumnTemplate>
    );
}

function ColumnCell(
    { col, formatters }: {
        col: NonNullable<ResolvedWidget["columns"]>[number];
        formatters?: TextFormatters;
    },
) {
    const hasProgress = !!col.progress;
    const hasIcon = !!col.icon?.file;
    const hasStats = !!col.stats;
    const primary = col.stats?.primary ?? col.primary;
    const secondary = col.stats?.secondary ?? col.secondary;
    const shouldRenderLabel = !!col.label && col.label !== primary;
    const statsCaption = hasStats ? col.primary : undefined;

    return (
        <div className="flex flex-col items-center gap-1.5 w-full">
            {shouldRenderLabel && (
                col.primaryAction
                    ? (
                        <a
                            href={col.primaryAction}
                            className="text-[11px] opacity-60 uppercase tracking-wide leading-tight text-center line-clamp-2"
                        >
                            {renderLocalizedText(col.label, formatters)}
                        </a>
                    )
                    : (
                        <p className="text-[11px] opacity-60 uppercase tracking-wide leading-tight text-center line-clamp-2">
                            {renderLocalizedText(col.label, formatters)}
                        </p>
                    )
            )}

            {!hasStats && hasProgress && (
                <CircularProgress
                    value={col.progress!.value ?? 0}
                    thresholds={col.progress!.thresholds}
                    zeroLabel={col.progress!.zero_label}
                />
            )}

            {!hasStats && !hasProgress && hasIcon && (
                <AppIcon
                    source={col.icon!.file}
                    alt={col.icon!.description ?? ""}
                    size={col.icon!.size ?? 32}
                    className="object-contain"
                    useFrostedGradient={col.icon!.useFrostedGradient}
                />
            )}

            {hasStats && primary && (
                col.primaryAction
                    ? (
                        <a
                            href={col.primaryAction}
                            className="font-semibold leading-tight text-center line-clamp-2"
                        >
                            {renderLocalizedText(primary, formatters)}
                        </a>
                    )
                    : (
                        <p className="font-semibold leading-tight text-center line-clamp-2">
                            {renderLocalizedText(primary, formatters)}
                        </p>
                    )
            )}

            {hasStats && secondary && (
                <p className="text-xs opacity-70 leading-tight text-center">
                    {renderLocalizedText(secondary, formatters)}
                </p>
            )}

            {statsCaption && (
                col.primaryAction
                    ? (
                        <a
                            href={col.primaryAction}
                            className="block max-w-full text-sm font-semibold leading-tight text-center hover:text-primary transition-colors line-clamp-2"
                        >
                            {renderLocalizedText(statsCaption, formatters)}
                        </a>
                    )
                    : (
                        <p className="font-semibold text-sm leading-tight text-center line-clamp-2">
                            {renderLocalizedText(statsCaption, formatters)}
                        </p>
                    )
            )}

            {!hasStats && primary && (
                col.primaryAction
                    ? (
                        <a
                            href={col.primaryAction}
                            className="block max-w-full text-sm font-semibold leading-tight text-center hover:text-primary transition-colors line-clamp-2"
                        >
                            {renderLocalizedText(primary, formatters)}
                        </a>
                    )
                    : (
                        <p className="font-semibold text-sm leading-tight text-center line-clamp-2">
                            {renderLocalizedText(primary, formatters)}
                        </p>
                    )
            )}

            {!hasStats && secondary && (
                <p className="text-xs opacity-70 leading-tight text-center">
                    {renderLocalizedText(secondary, formatters)}
                </p>
            )}

            {col.title && (
                col.titleAction
                    ? (
                        <a
                            href={col.titleAction}
                            className="text-xs font-medium hover:text-primary transition-colors truncate max-w-full"
                        >
                            {renderLocalizedText(col.title, formatters)}
                        </a>
                    )
                    : (
                        <p className="text-xs font-medium truncate max-w-full">
                            {renderLocalizedText(col.title, formatters)}
                        </p>
                    )
            )}

            {col.badge?.show && col.badge.tooltip && (
                <span
                    title={col.badge.tooltip}
                    className="text-[10px] text-amber-400 cursor-help"
                    aria-label={col.badge.tooltip}
                >
                    ⚠
                </span>
            )}
        </div>
    );
}

function CircularProgress({
    value,
    thresholds,
    zeroLabel,
}: {
    value: number;
    thresholds?: Array<{ min: number; color: string }>;
    zeroLabel?: string;
}) {
    const color = thresholds
        ? ([...thresholds]
            .sort((a, b) => b.min - a.min)
            .find((t) => value >= t.min)?.color ?? "#888888")
        : "var(--primary)";

    const radius = 18;
    const circ = 2 * Math.PI * radius;
    const dash = Math.max(0, Math.min(value / 100, 1)) * circ;

    return (
        <svg width={44} height={44} viewBox="0 0 44 44" className="shrink-0">
            <circle
                cx={22}
                cy={22}
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={4}
            />
            <circle
                cx={22}
                cy={22}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={4}
                strokeDasharray={`${dash} ${circ}`}
                strokeLinecap="round"
                transform="rotate(-90 22 22)"
                style={{ transition: "stroke-dasharray 0.4s ease" }}
            />
            <text
                x={22}
                y={26}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                fontWeight={600}
            >
                {value === 0 && zeroLabel ? zeroLabel : `${Math.round(value)}%`}
            </text>
        </svg>
    );
}
