"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import { closestCenter, DndContext, DragEndEvent, DragOverEvent, DragStartEvent, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical, Maximize2, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import PagesTabs from "../PagesTabs";
import UpdateDetailsDialogComponent from "./UpdateDetailsDialog";
import QuickLaunchPopover from "./QuickLaunchPopover";
import useAuth from "@/context/useAuth";
import { useActivity } from "@/context/ActivityContext";
import { getPageIntegrationDataAction, updatePageConfigAction } from '@/lib/apiClient';
import { renderWidget } from "../widgets/Widget";
import PageNotFound from "../errorPages/PageNotFound";
import { primePageIntegrationConsumerCache } from "@/lib/pageIntegrationDataCache";
import config from "@/lib/config";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const COLUMN_ORDER = ["left", "middle", "right"] as const;
type Column = (typeof COLUMN_ORDER)[number];
type WidgetSize = "auto" | "compact" | "tall";

type WidgetMenuState = {
    refreshVersion: number;
    size: WidgetSize;
    blurred: boolean;
};

const WIDGET_SIZE_CLASSNAME: Record<WidgetSize, string> = {
    auto: "",
    compact: "h-[180px] overflow-hidden rounded-xl",
    tall: "h-[360px] overflow-hidden rounded-xl",
};

const PRIVACY_BLUR_LINES = [
    "kJ8fL2pQwR9z",
    "xN4vB7mC3sA1",
    "tY6uI0oP5dF2",
];

const COLUMN_CLASSNAME: Record<Column, string> = {
    left:
        "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-2 overflow-y-visible min-w-0 min-h-0 h-fit p-1",
    middle:
        "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-2 overflow-x-hidden min-w-0 min-h-0 h-fit p-1",
    right:
        "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-2 overflow-y-visible min-w-0 min-h-0 h-fit p-1",
};

const COLUMN_PANEL_IDS: Record<Column, string | undefined> = {
    left: "left-widget-panel",
    middle: undefined,
    right: "right-widget-panel",
};

function SortableDashboardWidget({
    id,
    children,
    isActive,
}: {
    id: string;
    children: ReactNode;
    isActive: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    return (
        <div
            ref={setNodeRef}
            style={{ transform: isDragging ? undefined : CSS.Transform.toString(transform), transition }}
            className={isActive ? "group relative opacity-40" : "group relative"}
        >
            {children}
            <button
                type="button"
                aria-label={`Rearrange ${id}`}
                className="absolute right-2 top-2 z-40 cursor-grab rounded-full bg-white/10 p-2 text-white opacity-0 backdrop-blur transition hover:bg-white/20 group-hover:opacity-100 focus:opacity-100 active:cursor-grabbing"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-4 w-4" />
            </button>
        </div>
    );
}

function WidgetDropPreview({ type, params }: { type: string; params?: Record<string, any> }) {
    return (
        <div className="mb-3 overflow-hidden rounded-lg border-2 border-dashed border-primary/70 bg-primary/10 p-1 opacity-80 transition-[height,opacity,transform] duration-200 ease-out animate-pulse">
            {renderWidget({
                type,
                params,
                className: "pointer-events-none h-[90px] w-full opacity-70",
                isPreview: true,
            })}
        </div>
    );
}

function DashboardColumnDropZone({
    id,
    panelId,
    className,
    style,
    children,
}: {
    id: string;
    panelId?: string;
    className: string;
    style: CSSProperties;
    children: ReactNode;
}) {
    const { setNodeRef } = useDroppable({ id });
    return <div ref={setNodeRef} id={panelId} className={className} style={style}>{children}</div>;
}

function sortWidgetEntries(entries: Record<string, any>) {
    return Object.entries(entries).sort(
        ([leftKey, leftValue], [rightKey, rightValue]) => {
            const leftIndex =
                typeof leftValue?.index === "number" &&
                    Number.isFinite(leftValue.index)
                    ? leftValue.index
                    : Number.MAX_SAFE_INTEGER;
            const rightIndex =
                typeof rightValue?.index === "number" &&
                    Number.isFinite(rightValue.index)
                    ? rightValue.index
                    : Number.MAX_SAFE_INTEGER;

            if (leftIndex !== rightIndex) return leftIndex - rightIndex;
            return leftKey.localeCompare(rightKey);
        },
    );
}

export default function DashboardLayoutTemplate({
    config,
    pageName,
    isLoading = false,
}: {
    config: Record<string, any> | null;
    pageName?: string;
    isLoading?: boolean;
}) {
    const [searchParams] = useSearchParams();
    const { token, withAuth } = useAuth();
    const openFromURL = searchParams.get("search") === "1";
    const hasSearchBarWidget = useMemo(() => {
        const columns = config?.columns as
            | Record<Column, Record<string, any>>
            | undefined;

        if (!columns) return false;

        return COLUMN_ORDER.some((columnName) => {
            const entries = columns[columnName];
            return !!entries && typeof entries === "object" &&
                Object.keys(entries).some((entryKey) =>
                    entryKey === "search-bar"
                );
        });
    }, [config]);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const [activePanel, setActivePanel] = useState<number>(1);
    const [widgetMenuState, setWidgetMenuState] = useState<Record<string, WidgetMenuState>>({});
    const [dashboardConfig, setDashboardConfig] = useState(config);
    const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<{ column: Column; key: string | null } | null>(null);
    const [dragPreview, setDragPreview] = useState<{ type: string; params?: Record<string, any> } | null>(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

    useEffect(() => setDashboardConfig(config), [config]);

    const heightRefs = useRef<Record<string, HTMLElement | null>>({});
    const heightRefCallbacks = useRef<
        Record<string, (node: HTMLElement | null) => void>
    >({});
    const [heightRefVersion, setHeightRefVersion] = useState(0);
    const [measuredHeights, setMeasuredHeights] = useState<
        Record<string, number>
    >({});

    const columns = dashboardConfig?.columns as
        | Record<Column, Record<string, any>>
        | undefined;

    const refreshPageIntegrationData = useCallback(async () => {
        const response = await withAuth((auth) =>
            getPageIntegrationDataAction(auth, pageName),
        ) as any;
        primePageIntegrationConsumerCache(response);
    }, [pageName, withAuth]);

    useEffect(() => {
        let cancelled = false;

        const primeIntegrationData = async () => {
            try {
                await refreshPageIntegrationData();
                if (cancelled) return;
            } catch (error) {
                if (!cancelled) {
                    console.error("Failed to prime page integration data", error);
                }
            }
        };

        void primeIntegrationData();

        // Poll for integration data periodically instead of using websockets.
        let intervalId: number | null = null;
        const POLL_INTERVAL_MS = 10000;

        const startPolling = () => {
            if (intervalId) return;
            intervalId = window.setInterval(async () => {
                try {
                    await refreshPageIntegrationData();
                    if (cancelled) return;
                } catch (error) {
                    if (!cancelled) console.error("Failed to poll page integration data", error);
                }
            }, POLL_INTERVAL_MS);
        };

        // Start polling if we have a token (otherwise polling is a no-op)
        if (token) startPolling();

        return () => {
            cancelled = true;
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };
    }, [refreshPageIntegrationData, token]);

    // Scroll to center panel on mobile first render
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        if (window.innerWidth >= 768) return;
        requestAnimationFrame(() => {
            try {
                const width = el.clientWidth || window.innerWidth;
                el.scrollTo({ left: width * 1, behavior: "auto" });
                setActivePanel(1);
            } catch {}
        });
    }, []);

    // Track active panel on scroll
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        let raf = 0;
        const onScroll = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const width = el.clientWidth || window.innerWidth;
                const idx = Math.round(el.scrollLeft / width);
                setActivePanel(Math.min(2, Math.max(0, idx)));
            });
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        return () => {
            el.removeEventListener("scroll", onScroll);
            cancelAnimationFrame(raf);
        };
    }, []);

    // Mobile touch snap
    useEffect(() => {
        const el = containerRef.current;
        if (!el || window.innerWidth >= 768) return;

        let rafId: number | null = null;
        let timeoutId: number | null = null;
        let startX = 0;
        let startTime = 0;
        let childScrollable: HTMLElement | null = null;
        let childCanScrollLeft = false;
        let childCanScrollRight = false;

        const findHorizontallyScrollable = (
            node: Element | null,
        ): HTMLElement | null => {
            while (node && node !== el) {
                const n = node as HTMLElement;
                const style = getComputedStyle(n);
                if (
                    n.scrollWidth > n.clientWidth + 1 &&
                    style.overflowX !== "hidden"
                ) return n;
                node = node.parentElement;
            }
            return null;
        };

        const onTouchStart = (e: TouchEvent) => {
            startX = e.touches[0].clientX;
            startTime = e.timeStamp;
            childScrollable = findHorizontallyScrollable(e.target as Element);
            if (childScrollable) {
                childCanScrollLeft = childScrollable.scrollLeft > 0;
                childCanScrollRight =
                    childScrollable.scrollLeft + childScrollable.clientWidth <
                        childScrollable.scrollWidth - 1;
            } else {
                childCanScrollLeft = childCanScrollRight = false;
            }
            if (rafId) cancelAnimationFrame(rafId);
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            const endX = e.changedTouches[0].clientX;
            const dx = startX - endX;
            const dt = Math.max(1, e.timeStamp - startTime);
            const velocity = dx / dt;

            if (childScrollable) {
                if (dx > 0 && childCanScrollRight) return;
                if (dx < 0 && childCanScrollLeft) return;
            }

            const width = el.clientWidth || window.innerWidth;
            let projected = el.scrollLeft + velocity * 250;
            const baseIdx = Math.round(el.scrollLeft / width);
            const distanceIdx = baseIdx + (dx > 0 ? 1 : -1);
            let idx = Math.round(projected / width);
            if (Math.abs(dx) < width * 0.3) idx = distanceIdx;
            idx = Math.max(
                0,
                Math.min(idx, Math.ceil(el.scrollWidth / width) - 1),
            );

            const abs = Math.abs(dx);
            const delay = abs < 20 ? 120 : abs < 80 ? 220 : 320;

            rafId = requestAnimationFrame(() => {
                timeoutId = window.setTimeout(() => {
                    el.scrollTo({ left: idx * width, behavior: "smooth" });
                    timeoutId = null;
                }, delay);
            });
        };

        const onTouchCancel = () => {
            const width = el.clientWidth || window.innerWidth;
            const idx = Math.round(el.scrollLeft / width);
            el.scrollTo({ left: idx * width, behavior: "smooth" });
            setActivePanel(Math.min(2, Math.max(0, idx)));
        };

        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchend", onTouchEnd, { passive: true });
        el.addEventListener("touchcancel", onTouchCancel, { passive: true });

        return () => {
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("touchcancel", onTouchCancel);
            if (rafId) cancelAnimationFrame(rafId);
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, []);

    // Height ref callbacks for $ref system
    const getHeightRefCallback = useCallback((key: string) => {
        if (!heightRefCallbacks.current[key]) {
            heightRefCallbacks.current[key] = (node: HTMLElement | null) => {
                if (heightRefs.current[key] === node) return;
                heightRefs.current[key] = node;
                setHeightRefVersion((v) => v + 1);
            };
        }
        return heightRefCallbacks.current[key];
    }, []);

    // Collect all $ref keys used in height values
    const referencedHeightKeys = useMemo(() => {
        if (!columns) return [];
        const keys = new Set<string>();
        for (const col of Object.values(columns)) {
            if (!col || typeof col !== "object") continue;
            for (const entryConfig of Object.values(col)) {
                const h = (entryConfig as any)?.height;
                if (typeof h === "string" && h.startsWith("$")) {
                    keys.add(h.slice(1));
                }
            }
        }
        return Array.from(keys);
    }, [columns]);

    const referencedHeightKeyString = referencedHeightKeys.join("|");

    useEffect(() => {
        if (referencedHeightKeys.length === 0) {
            setMeasuredHeights((
                prev,
            ) => (Object.keys(prev).length === 0 ? prev : {}));
            return;
        }
        if (typeof ResizeObserver === "undefined") return;

        const observers = new Map<string, ResizeObserver>();
        referencedHeightKeys.forEach((key) => {
            const node = heightRefs.current[key];
            if (!node) return;
            const measure = () => {
                const nextHeight = Math.round(
                    node.getBoundingClientRect().height,
                );
                setMeasuredHeights((prev) => {
                    if (prev[key] === nextHeight) return prev;
                    return { ...prev, [key]: nextHeight };
                });
            };
            measure();
            const observer = new ResizeObserver(measure);
            observer.observe(node);
            observers.set(key, observer);
        });

        return () => observers.forEach((o) => o.disconnect());
    }, [referencedHeightKeyString, heightRefVersion]);

    const layoutStyleVars = useMemo<CSSProperties | undefined>(() => {
        if (Object.keys(measuredHeights).length === 0) return undefined;
        const cssVars = {} as CSSProperties;
        for (const [key, value] of Object.entries(measuredHeights)) {
            (cssVars as Record<string, string>)[`--layout-${key}`] =
                `${value}px`;
        }
        return cssVars;
    }, [measuredHeights]);

    const getWidgetMenuState = (baseKey: string): WidgetMenuState =>
        widgetMenuState[baseKey] ?? {
            refreshVersion: 0,
            size: "auto",
            blurred: false,
        };

    const updateWidgetMenuState = (
        baseKey: string,
        updater: (current: WidgetMenuState) => WidgetMenuState,
    ) => {
        setWidgetMenuState((current) => {
            const previous = current[baseKey] ?? {
                refreshVersion: 0,
                size: "auto" as WidgetSize,
                blurred: false,
            };
            return { ...current, [baseKey]: updater(previous) };
        });
    };

    const refreshWidget = (baseKey: string) => {
        void refreshPageIntegrationData()
            .catch((error) => {
                console.error("Failed to refresh widget data", error);
            })
            .finally(() => {
                updateWidgetMenuState(baseKey, (current) => ({
                    ...current,
                    refreshVersion: current.refreshVersion + 1,
                }));
            });
    };

    const resizeWidget = (baseKey: string) => {
        updateWidgetMenuState(baseKey, (current) => ({
            ...current,
            size: current.size === "auto" ? "compact" : current.size === "compact" ? "tall" : "auto",
        }));
    };

    const toggleWidgetBlur = (baseKey: string) => {
        updateWidgetMenuState(baseKey, (current) => ({
            ...current,
            blurred: !current.blurred,
        }));
    };

    const persistColumns = async (nextColumns: Record<Column, Record<string, any>>) => {
        if (!dashboardConfig) return;
        const nextConfig = { ...dashboardConfig, columns: nextColumns };
        setDashboardConfig(nextConfig);
        try {
            await withAuth((auth) => updatePageConfigAction(auth, pageName, nextConfig as any));
        } catch (error) {
            console.error("Failed to save dashboard widget layout", error);
        }
    };

    const removeWidget = (widgetId: string) => {
        if (!columns) return;
        const nextColumns = { left: { ...columns.left }, middle: { ...columns.middle }, right: { ...columns.right } };
        const [column, entryKey] = widgetId.split("::");
        if (!column || !entryKey || !nextColumns[column as Column]?.[entryKey]) return;
        delete nextColumns[column as Column][entryKey];
        void persistColumns(nextColumns);
    };

    const handleWidgetDragEnd = (event: DragEndEvent) => {
        setActiveWidgetId(null);
        setDragOver(null);
        setDragPreview(null);
        if (!columns || !event.over) return;
        const activeId = String(event.active.id);
        const overId = String(event.over.id);
        const [fromColumn, fromKey] = activeId.split("::");
        const overParts = overId.split("::");
        const toColumn = (overParts[0] === "column" ? overParts[1] : overParts[0]) as Column;
        if (!COLUMN_ORDER.includes(fromColumn as Column) || !COLUMN_ORDER.includes(toColumn) || !fromKey) return;

        const sourceEntries = sortWidgetEntries(columns[fromColumn as Column]);
        const targetEntries = fromColumn === toColumn ? sourceEntries : sortWidgetEntries(columns[toColumn]);
        const fromIndex = sourceEntries.findIndex(([key]) => key === fromKey);
        if (fromIndex < 0) return;
        const [moving] = sourceEntries.splice(fromIndex, 1);
        const overKey = overParts[0] === "column" ? null : overParts[1];
        const overIndex = overKey ? targetEntries.findIndex(([key]) => key === overKey) : targetEntries.length;
        const insertIndex = Math.max(0, overIndex < 0 ? targetEntries.length : overIndex);
        if (fromColumn === toColumn) {
            sourceEntries.splice(insertIndex, 0, moving);
        } else {
            targetEntries.splice(insertIndex, 0, moving);
        }

        const nextColumns = { left: { ...columns.left }, middle: { ...columns.middle }, right: { ...columns.right } };
        for (const column of COLUMN_ORDER) {
            const entries = column === fromColumn ? sourceEntries : column === toColumn ? targetEntries : sortWidgetEntries(columns[column]);
            nextColumns[column] = Object.fromEntries(entries.map(([key, value], index) => [key, { ...value, index }]));
        }
        void persistColumns(nextColumns);
    };

    const handleWidgetDragOver = (event: DragOverEvent) => {
        if (!event.over) {
            setDragOver(null);
            return;
        }

        const [overType, overColumn, overKey] = String(event.over.id).split("::");
        if (overType === "column" && COLUMN_ORDER.includes(overColumn as Column)) {
            setDragOver({ column: overColumn as Column, key: null });
            return;
        }
        if (COLUMN_ORDER.includes(overType as Column) && overKey) {
            setDragOver({ column: overType as Column, key: overKey });
        }
    };

    const handleWidgetDragStart = (event: DragStartEvent) => {
        const activeId = String(event.active.id);
        setActiveWidgetId(activeId);
        const [column, key] = activeId.split("::");
        const cfg = columns?.[column as Column]?.[key];
        if (cfg) {
            setDragPreview({
                type: key,
                params: key === "placeholder" ? cfg.params : cfg,
            });
        }
    };

    const renderWidgetMenuWrapper = ({
        baseKey,
        wrapperClass,
        children,
        ref,
        style,
        onRemove,
    }: {
        baseKey: string;
        wrapperClass: string;
        children: ReactNode;
        ref?: (node: HTMLElement | null) => void;
        style?: CSSProperties;
        onRemove?: () => void;
    }) => {
        const state = getWidgetMenuState(baseKey);
        const sizeClass = WIDGET_SIZE_CLASSNAME[state.size];
        return (
            <div
                key={baseKey}
                ref={ref}
                className={[wrapperClass, "group/widget-menu relative", sizeClass].filter(Boolean).join(" ")}
                style={style}
            >
                <div key={state.refreshVersion} className={state.size === "auto" ? undefined : "h-full"}>
                    {children}
                </div>
                <div className="absolute right-12 top-2 z-30 flex items-center gap-1 opacity-0 transition-opacity group-hover/widget-menu:opacity-100 focus-within:opacity-100">
                    {onRemove && (
                        <button type="button" onClick={onRemove} aria-label={`Delete ${baseKey}`} className="rounded-full bg-white/10 p-2 text-white hover:bg-red-500/40 backdrop-blur">
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Widget options"
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white shadow-lg backdrop-blur-md transition hover:bg-black/55 focus:outline-none focus:ring-2 focus:ring-white/40"
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="frosted min-w-44 text-foreground">
                            <DropdownMenuItem onClick={() => refreshWidget(baseKey)}>
                                <RefreshCw className="h-4 w-4" />
                                Refresh data
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => resizeWidget(baseKey)}>
                                <Maximize2 className="h-4 w-4" />
                                Resize widget
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleWidgetBlur(baseKey)}>
                                <EyeOff className="h-4 w-4" />
                                {state.blurred ? "Unblur widget" : "Blur widget"}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                {state.blurred && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-center gap-2 rounded-xl bg-black/20 p-4 text-white/35 backdrop-blur-md">
                        {PRIVACY_BLUR_LINES.map((line) => (
                            <div key={line} className="h-3 w-full max-w-[85%] rounded-full bg-white/20 blur-[3px]">
                                <span className="sr-only">{line}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const renderWidgetEntry = (
        columnName: Column,
        entryKey: string,
        entryConfig: Record<string, any> | null | undefined,
    ) => {
        const cfg = entryConfig ?? {};
        const wrapperClass = ["mb-3", cfg.className].filter(Boolean).join(
            " ",
        );
        const baseKey = `${columnName}-${entryKey}`;
        const widgetId = `${columnName}::${entryKey}`;

        switch (entryKey) {
            case "placeholder": {
                const h = cfg.height;
                let heightStyle: string | undefined;
                if (typeof h === "string") {
                    heightStyle = h.startsWith("$")
                        ? `var(--layout-${h.slice(1)})`
                        : h;
                } else if (typeof h === "number") {
                    heightStyle = `${h}px`;
                }
                return (
                    renderWidgetMenuWrapper({
                        baseKey,
                        wrapperClass,
                        style: heightStyle ? { height: heightStyle } : undefined,
                        onRemove: () => removeWidget(widgetId),
                        children: renderWidget({
                            type: "placeholder",
                            params: cfg.params,
                            className: "h-full w-full",
                        }),
                    })
                );
            }
            case "main-clock": {
                const ref = getHeightRefCallback("main-clock");
                return (
                    renderWidgetMenuWrapper({
                        baseKey,
                        wrapperClass,
                        ref,
                        onRemove: () => removeWidget(widgetId),
                        children: renderWidget({
                            type: "main-clock",
                            params: cfg,
                            className: "w-full",
                        }),
                    })
                );
            }
            case "search-bar":
                return (
                    renderWidgetMenuWrapper({
                        baseKey,
                        wrapperClass,
                        onRemove: () => removeWidget(widgetId),
                        children: renderWidget({
                            type: "search-bar",
                            defaultOpen: openFromURL ?? false,
                        }),
                    })
                );
            case "link-view":
                return (
                    renderWidgetMenuWrapper({
                        baseKey,
                        wrapperClass,
                        onRemove: () => removeWidget(widgetId),
                        children: renderWidget({
                            type: "link-view",
                        }),
                    })
                );
            default:
                // Fall back to integration widget-by-key renderer, then to generic widget.
                return renderWidgetMenuWrapper({
                    baseKey,
                    wrapperClass,
                    children: renderWidget({
                        type: entryKey,
                        consumerKey: typeof cfg.configKey === "string" && cfg.configKey.trim()
                            ? cfg.configKey.trim()
                            : undefined,
                        params: cfg,
                        className: wrapperClass,
                    }),
                    onRemove: () => removeWidget(widgetId),
                });
        }
    };

    const renderColumnSkeleton = (columnName: Column) => {
        switch (columnName) {
            case "left":
                return (
                    <div className="space-y-4 w-full">
                        {/* Clock skeleton */}
                        <div className="h-[96px] w-full frosted rounded-xl animate-pulse flex items-center justify-center">
                            <div className="h-4 w-1/3 bg-white/10 rounded animate-pulse" />
                        </div>
                        {/* Widget panel skeleton */}
                        <div className="h-[250px] w-full frosted rounded-xl animate-pulse flex flex-col p-4 space-y-3">
                            <div className="h-4 w-1/4 bg-white/10 rounded animate-pulse" />
                            <div className="h-2.5 w-full bg-white/10 rounded animate-pulse" />
                            <div className="h-2.5 w-5/6 bg-white/10 rounded animate-pulse" />
                            <div className="h-2.5 w-4/6 bg-white/10 rounded animate-pulse" />
                        </div>
                    </div>
                );
            case "middle":
                return (
                    <div className="space-y-4 w-full">
                        {/* Search Bar skeleton */}
                        <div className="h-[42px] w-full frosted rounded-xl animate-pulse flex items-center px-4">
                            <div className="h-4 w-12 bg-white/10 rounded animate-pulse" />
                        </div>
                        {/* Link tiles grid skeleton */}
                        <div className="p-4 frosted rounded-xl w-full">
                            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                {Array.from({ length: 12 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className="aspect-square w-full frosted rounded-xl animate-pulse flex items-center justify-center"
                                    >
                                        <div className="w-1/2 h-1/2 rounded bg-white/10 animate-pulse" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case "right":
                return (
                    <div className="space-y-4 w-full">
                        <div className="h-[180px] w-full frosted rounded-xl animate-pulse flex flex-col p-4 space-y-3">
                            <div className="h-4 w-1/3 bg-white/10 rounded animate-pulse" />
                            <div className="h-2.5 w-full bg-white/10 rounded animate-pulse" />
                            <div className="h-2.5 w-full bg-white/10 rounded animate-pulse" />
                        </div>
                        <div className="h-[180px] w-full frosted rounded-xl animate-pulse flex flex-col p-4 space-y-3">
                            <div className="h-4 w-1/4 bg-white/10 rounded animate-pulse" />
                            <div className="h-2.5 w-full bg-white/10 rounded animate-pulse" />
                            <div className="h-2.5 w-5/6 bg-white/10 rounded animate-pulse" />
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    const renderColumn = (columnName: Column) => {
        const entries = columns?.[columnName];
        const sortedEntries = entries && typeof entries === "object" ? sortWidgetEntries(entries) : [];
    const dropPreviewIndex = dragOver?.column === columnName
        ? dragOver.key === null
            ? sortedEntries.length
                : (() => {
                    const index = sortedEntries.findIndex(([key]) => key === dragOver.key);
                    return index < 0 ? sortedEntries.length : index;
                })()
        : -1;
        return (
            <DashboardColumnDropZone
                key={columnName}
                id={`column::${columnName}`}
                panelId={COLUMN_PANEL_IDS[columnName]}
                className={COLUMN_CLASSNAME[columnName]}
                style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
            >
                {isLoading
                    ? (
                        renderColumnSkeleton(columnName)
                    )
                    : (
                        <SortableContext items={sortedEntries.map(([key]) => `${columnName}::${key}`)} strategy={verticalListSortingStrategy}>
                            {sortedEntries.flatMap(([key, cfg], index) => [
                                dropPreviewIndex === index && dragPreview ? (
                                    <WidgetDropPreview key={`preview-${columnName}-${key}`} type={dragPreview.type} params={dragPreview.params} />
                                ) : null,
                                <SortableDashboardWidget key={`${columnName}::${key}`} id={`${columnName}::${key}`} isActive={activeWidgetId === `${columnName}::${key}`}>
                                    {renderWidgetEntry(columnName, key, cfg as Record<string, any>)}
                                </SortableDashboardWidget>,
                            ])}
                            {dropPreviewIndex === sortedEntries.length && dragPreview ? (
                                <WidgetDropPreview type={dragPreview.type} params={dragPreview.params} />
                            ) : null}
                        </SortableContext>
                    )}
            </DashboardColumnDropZone>
        );
    };

    if (!config && !isLoading) {
        return <PageNotFound />;
    }

    return (
        <>
            <div className="grid grid-rows-[minmax(0,1fr)_36px] h-dvh pt-5 p-2 overflow-x-hidden text-(--surface-foreground) bg-(--surface)">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleWidgetDragStart}
                    onDragOver={handleWidgetDragOver}
                    onDragCancel={() => { setActiveWidgetId(null); setDragOver(null); setDragPreview(null); }}
                    onDragEnd={handleWidgetDragEnd}
                >
                <main
                    id="page-content-container"
                    ref={containerRef}
                    className="
                    flex snap-x snap-mandatory overflow-x-auto touch-pan-x overflow-y-auto scrollbar-hidden md:scrollbar-auto md:overflow-x-hidden
                    md:grid md:grid-cols-[25%_1fr_25%] min-h-0 overscroll-none
                "
                    style={layoutStyleVars}
                >
                    {COLUMN_ORDER.map(renderColumn)}
                </main>
                </DndContext>

                <BottomNavbar
                    activePanel={activePanel}
                    columns={columns}
                />
            </div>
            {openFromURL && !hasSearchBarWidget && (
                <div className="hidden">
                    {renderWidget({
                        type: "search-bar",
                        defaultOpen: true,
                    })}
                </div>
            )}
        </>
    );
}

interface BottomNavbarProps {
    activePanel?: number;
    setScreensaverActive?: (active: boolean) => void;
    showPages?: boolean;
    columns?: Record<string, any>;
}

function BottomNavbar({
    activePanel = 1,
    setScreensaverActive,
    showPages = true,
    columns,
}: BottomNavbarProps) {
    const { user } = useAuth();
    const { unreadCount } = useActivity();
    const [showSmartFrameButton, setShowSmartFrameButton] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(() => {
        return typeof document !== "undefined" && !!document.fullscreenElement;
    });

    useEffect(() => {
        const checkConfig = () => {
            const local = localStorage.getItem("dashwise_screensaver_local");
            const localConfig = local ? JSON.parse(local) : null;
            const globalConfig = user?.screensaverPreferences as any;

            const showLocal = localConfig?.showButton === true;
            const showGlobal = globalConfig?.showButton === true;

            setShowSmartFrameButton(showLocal || showGlobal);
        };

        checkConfig();
        window.addEventListener("dashwise_local_config_updated", checkConfig);
        return () =>
            window.removeEventListener(
                "dashwise_local_config_updated",
                checkConfig,
            );
    }, [user?.screensaverPreferences]);

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener("fullscreenchange", onFullscreenChange);
        onFullscreenChange();

        return () => {
            document.removeEventListener(
                "fullscreenchange",
                onFullscreenChange,
            );
        };
    }, []);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                return;
            }

            await document.documentElement.requestFullscreen();
        } catch (error) {
            console.error(error);
        }
    }, []);

    const hasLeftColumn = columns?.left && Object.keys(columns.left).length > 0;
    const hasRightColumn = columns?.right &&
        Object.keys(columns.right).length > 0;
    const showThreeDots = !!(hasLeftColumn && hasRightColumn);

    const gearStyle = `
        .gear-rotate { display: inline-block; }
        .gear-link:hover .gear-rotate { animation: dashwise-rotate-180 600ms ease-in-out forwards; }
        @keyframes dashwise-rotate-180 { from { transform: rotate(0deg); } to { transform: rotate(180deg); } }
    `;

    return (
        <>
            <style>{gearStyle}</style>
            <div
                className="grid grid-cols-[1fr_auto_1fr] items-center md:px-0 mb-2"
                id="page-footer"
            >
            <div id="app-details" className="flex items-center gap-2">
                <Link to="/home" className="flex items-center gap-2">
                    <img src="/dashwise-icon.png" alt="" className="h-9" />
                    <span className="hidden md:flex font-semibold">{config.instance_name || "dashwise"}</span>
                </Link>
                <QuickLaunchPopover />
                <a
                    href="https://github.com/andreasmolnardev/dashwise-next"
                    className="hidden md:flex frosted rounded-full p-1 transition-colors duration-200 group"
                >
                    <img
                        src="/icons/png/github-light.png"
                        alt="GitHub"
                        className="h-5 w-5 opacity-85 group-hover:opacity-100 transition-opacity duration-200"
                    />
                </a>
                <div className="hidden md:flex aspect-square rounded-full frosted w-2 h-2" />
                <UpdateDetailsDialogComponent />
            </div>

            <div className="flex justify-center">
                {showPages && <PagesTabs />}
                <div className="md:hidden fixed left-0 right-0 bottom-6 flex justify-center z-50 pointer-events-none">
                    <div className="pointer-events-auto bg-transparent px-2 py-1 rounded-full">
                        <DotIndicator
                            showThreeDots={showThreeDots}
                            active={activePanel}
                        />
                    </div>
                </div>
            </div>

            <ul className="grid grid-flow-col auto-cols-max items-center justify-end gap-2">
                {showSmartFrameButton && (
                    <li>
                        <Link
                            to="../frame"
                            className="hidden md:flex frosted p-2.5 rounded-full group transition-colors duration-200 aspect-square items-center justify-center"
                            title="Open Smart Frame"
                        >
                            <Icon
                                icon="teenyicons:screen-solid"
                                className="text-foreground group-hover:text-primary transition-colors duration-200"
                            />
                        </Link>
                    </li>
                )}
                <li className="relative">
                    <Link
                        to="/apps/monitoring/notifications"
                        className="hidden md:flex frosted p-2.5 rounded-full group transition-colors duration-200 aspect-square items-center justify-center"
                    >
                        <Icon
                            icon="fa6-solid:bell"
                            className="text-foreground group-hover:text-primary transition-colors duration-200"
                        />
                    </Link>
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white pointer-events-none">
                            {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                    )}
                </li>
                <li>
                    <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="frosted p-2.5 rounded-full group transition-colors duration-200 aspect-square flex items-center justify-center"
                        title={isFullscreen
                            ? "Exit fullscreen"
                            : "Enter fullscreen"}
                        aria-label={isFullscreen
                            ? "Exit fullscreen"
                            : "Enter fullscreen"}
                    >
                        <Icon
                            icon={isFullscreen
                                ? "fa6-solid:compress"
                                : "fa6-solid:expand"}
                            className="text-foreground group-hover:text-primary transition-colors duration-200"
                        />
                    </button>
                </li>
                <li>
                    <Link
                        to="/settings/appearance"
                        className="frosted p-2.5 rounded-full gear-link transition-colors duration-200 aspect-square flex items-center justify-center"
                    >
                        <Icon
                            icon="fa6-solid:gear"
                            className="gear-rotate text-foreground group-hover:text-primary transition-colors duration-200"
                        />
                    </Link>
                </li>
            </ul>
        </div>
        </>
    );
}

function DotIndicator(
    { showThreeDots, active }: { showThreeDots: boolean; active: number },
) {
    const dotBase =
        "inline-block w-2.5 h-2.5 rounded-full transition-transform transition-opacity";
    const activeClasses = "scale-110 opacity-100";
    const inactiveClasses = "scale-100 opacity-60";

    if (!showThreeDots) {
        return (
            <div className="flex items-center gap-2">
                <span
                    className={`${dotBase} ${
                        active === 1 ? activeClasses : inactiveClasses
                    } bg-white`}
                    aria-hidden
                />
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2">
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    aria-hidden
                    className={`${dotBase} ${
                        active === i ? activeClasses : inactiveClasses
                    } bg-white`}
                />
            ))}
        </div>
    );
}
