"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "@iconify-icon/react";
import PagesTabs from "../PagesTabs";
import UpdateDetailsDialogComponent from "./UpdateDetailsDialog";
import QuickLaunchPopover from "./QuickLaunchPopover";
import useAuth from "@/context/useAuth";
import { getNotificationsAction } from "@/app/actions/notifications/items";
import { getPageIntegrationDataAction } from "@/app/actions/pageConfigs";
import { renderWidget } from "../widgets/Widget";
import PageNotFound from "../errorPages/PageNotFound";
import { clearPageIntegrationConsumerCache, primePageIntegrationConsumerCache } from "@/lib/pageIntegrationDataCache";

const COLUMN_ORDER = ["left", "middle", "right"] as const;
type Column = (typeof COLUMN_ORDER)[number];

const COLUMN_CLASSNAME: Record<Column, string> = {
    left:
        "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-y-visible min-w-0 min-h-0 h-fit p-1",
    middle:
        "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-x-hidden min-w-0 min-h-0 h-fit p-1",
    right:
        "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-y-visible min-w-0 min-h-0 h-fit p-1",
};

const COLUMN_PANEL_IDS: Record<Column, string | undefined> = {
    left: "left-widget-panel",
    middle: undefined,
    right: "right-widget-panel",
};

const FRONTEND_ONLY_WIDGETS = new Set([
    "placeholder",
    "main-clock",
    "glanceable-clock",
    "search-bar",
    "link-view",
]);

function sortWidgetEntries(entries: Record<string, any>) {
    return Object.entries(entries).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const leftIndex = typeof leftValue?.index === "number" && Number.isFinite(leftValue.index)
            ? leftValue.index
            : Number.MAX_SAFE_INTEGER;
        const rightIndex = typeof rightValue?.index === "number" && Number.isFinite(rightValue.index)
            ? rightValue.index
            : Number.MAX_SAFE_INTEGER;

        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return leftKey.localeCompare(rightKey);
    });
}

export default function DashboardLayoutTemplate({
    config,
    pageName,
}: {
    config: Record<string, any>;
    pageName?: string;
}) {
    const { withAuth } = useAuth();
    const [searchParams] = useSearchParams();
    const openFromURL = searchParams.get("search") === "1";

    const containerRef = useRef<HTMLDivElement | null>(null);
    const [activePanel, setActivePanel] = useState<number>(1);

    const heightRefs = useRef<Record<string, HTMLElement | null>>({});
    const heightRefCallbacks = useRef<
        Record<string, (node: HTMLElement | null) => void>
    >({});
    const [heightRefVersion, setHeightRefVersion] = useState(0);
    const [measuredHeights, setMeasuredHeights] = useState<
        Record<string, number>
    >({});
    const [integrationDataReady, setIntegrationDataReady] = useState(false);

    if (!config) {
        return <PageNotFound />
    }

    const columns = config.columns as
        | Record<Column, Record<string, any>>
        | undefined;

    useEffect(() => {
        let cancelled = false;

        const loadPageIntegrationData = async () => {
            setIntegrationDataReady(false);
            clearPageIntegrationConsumerCache();

            try {
                const payload = await withAuth((auth) =>
                    getPageIntegrationDataAction(
                        auth,
                        pageName,
                    )
                );
                if (cancelled) return;
                primePageIntegrationConsumerCache(payload as any);
            } catch {
                if (cancelled) return;
                clearPageIntegrationConsumerCache();
            } finally {
                if (!cancelled) {
                    setIntegrationDataReady(true);
                }
            }
        };

        void loadPageIntegrationData();

        return () => {
            cancelled = true;
        };
    }, [config, pageName, withAuth]);

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

    const renderWidgetEntry = (
        columnName: Column,
        entryKey: string,
        entryConfig: Record<string, any> | null | undefined,
        entryIndex: number,
    ) => {  
        const cfg = entryConfig ?? {};
        const wrapperClass = ["mb-3.5", cfg.className].filter(Boolean).join(
            " ",
        );
        const baseKey = `${columnName}-${entryKey}-${entryIndex}`;

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
                    <div
                        key={baseKey}
                        className={wrapperClass}
                        style={heightStyle
                            ? { height: heightStyle }
                            : undefined}
                    >
                        {renderWidget({
                            type: "placeholder",
                            params: cfg.params,
                            className: "h-full w-full",
                        })}
                    </div>
                );
            }
            case "main-clock": {
                const ref = getHeightRefCallback("main-clock");
                return (
                    <div key={baseKey} className={wrapperClass} ref={ref}>
                        {renderWidget({
                            type: "main-clock",
                            params: cfg,
                            className: "w-full",
                        })}
                    </div>
                );
            }
            case "search-bar":
                return (
                    <div key={baseKey} className={wrapperClass}>
                        {renderWidget({
                            type: "search-bar",
                            defaultOpen: openFromURL ?? false,
                        })}
                    </div>
                );
            case "link-view":
                return (
                    <div key={baseKey} className={wrapperClass}>
                        {renderWidget({
                            type: "link-view"
                        })}
                    </div>
                    
                );
            default:
                // Fall back to integration widget-by-key renderer, then to generic widget.
                return (
                    <div key={baseKey} className={wrapperClass}>
                        {renderWidget({
                            type: entryKey,
                            params: cfg,
                            className: wrapperClass,
                        })}
                    </div>
                );
        }
    };

    const renderColumn = (columnName: Column) => {
        const entries = columns?.[columnName];
        return (
            <div
                key={columnName}
                id={COLUMN_PANEL_IDS[columnName]}
                className={COLUMN_CLASSNAME[columnName]}
                style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
            >
                {entries && typeof entries === "object"
                    ? sortWidgetEntries(entries).map(([key, cfg], i) =>
                        renderWidgetEntry(columnName, key, cfg as Record<string, any>, i)
                    )
                    : null}
            </div>
        );
    };

    return (
        <div className="grid grid-rows-[minmax(0,1fr)_36px] h-dvh pt-5 md:p-3.5 p-0 overflow-x-hidden text-(--surface-foreground) bg-(--surface)">
            <main
                id="page-content-container"
                ref={containerRef}
                className="
                    flex snap-x snap-mandatory overflow-x-auto touch-pan-x overflow-y-auto scrollbar-hidden md:scrollbar-auto md:overflow-x-hidden
                    md:grid md:grid-cols-[25%_1fr_25%] min-h-0 overscroll-none
                "
                style={layoutStyleVars}
            >
                {integrationDataReady ? COLUMN_ORDER.map(renderColumn) : null}
            </main>

            <BottomNavbar
                activePanel={activePanel}
                columns={columns}
            />
        </div>
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
    const { token, withAuth } = useAuth();
    const [unreadCount, setUnreadCount] = useState<number>(0);

    useEffect(() => {
        const fetchNotifications = async () => {
            if (!token) return;
            try {
                const data = await withAuth((auth) =>
                    getNotificationsAction(auth, false, true)
                ) as any;
                setUnreadCount(data?.unread || 0);
            } catch (err) {
                console.error(err);
            }
        };
        fetchNotifications();
    }, [token, withAuth]);

    const hasLeftColumn = columns?.left && Object.keys(columns.left).length > 0;
    const hasRightColumn = columns?.right &&
        Object.keys(columns.right).length > 0;
    const showThreeDots = !!(hasLeftColumn && hasRightColumn);

    return (
        <div
            className="grid grid-cols-[1fr_auto_1fr] items-center px-3 md:px-0"
            id="page-footer"
        >
            <div id="app-details" className="flex items-center gap-2">
                <Link to="/home" className="flex items-center gap-2">
                    <img src="/dashwise-icon.png" alt="" className="h-9" />
                    <span className="font-semibold">dashwise</span>
                </Link>
                <QuickLaunchPopover />
                <a
                    href="https://github.com/andreasmolnardev/dashwise-next"
                    className="frosted rounded-full p-1 transition-colors duration-200 group"
                >
                    <img
                        src="/icons/png/github-light.png"
                        alt="GitHub"
                        className="h-5 w-5 opacity-85 group-hover:opacity-100 transition-opacity duration-200"
                    />
                </a>
                <div className="aspect-square rounded-full frosted w-2 h-2" />
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

            <ul className="grid grid-flow-col auto-cols-max items-center justify-end gap-3">
                <li className="relative">
                    <Link
                        to="/notifications"
                        className="frosted p-2 rounded-full group transition-colors duration-200 aspect-square flex items-center justify-center"
                    >
                        <Icon
                            icon="fa6-solid:bell"
                            className="text-foreground group-hover:text-primary transition-colors duration-200"
                        />
                    </Link>
                    {unreadCount > 0 && (
                        <span className="absolute -top-3 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white pointer-events-none">
                            {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                    )}
                </li>
                <li>
                    <Link
                        to="/settings/appearance"
                        className="frosted p-2 rounded-full group transition-colors duration-200 aspect-square flex items-center justify-center"
                    >
                        <Icon
                            icon="fa6-solid:gear"
                            className="text-foreground group-hover:text-primary transition-colors duration-200"
                        />
                    </Link>
                </li>
            </ul>
        </div>
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
