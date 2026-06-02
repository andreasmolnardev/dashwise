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
import { primePageIntegrationConsumerCache } from "@/lib/pageIntegrationDataCache";
import config from "@/lib/config";

const COLUMN_ORDER = ["left", "middle", "right"] as const;
type Column = (typeof COLUMN_ORDER)[number];

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
    const [integrationDataVersion, setIntegrationDataVersion] = useState(0);

    const heightRefs = useRef<Record<string, HTMLElement | null>>({});
    const heightRefCallbacks = useRef<
        Record<string, (node: HTMLElement | null) => void>
    >({});
    const [heightRefVersion, setHeightRefVersion] = useState(0);
    const [measuredHeights, setMeasuredHeights] = useState<
        Record<string, number>
    >({});

    if (!config && !isLoading) {
        return <PageNotFound />;
    }

    const columns = config?.columns as
        | Record<Column, Record<string, any>>
        | undefined;

    useEffect(() => {
        let cancelled = false;

        const primeIntegrationData = async () => {
            try {
                const response = await withAuth((auth) =>
                    getPageIntegrationDataAction(auth, pageName),
                ) as any;

                if (cancelled) return;

                primePageIntegrationConsumerCache(response);
                setIntegrationDataVersion((current) => current + 1);
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
                    const response = await withAuth((auth) =>
                        getPageIntegrationDataAction(auth, pageName),
                    ) as any;

                    if (cancelled) return;

                    primePageIntegrationConsumerCache(response);
                    setIntegrationDataVersion((current) => current + 1);
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
    }, [pageName, token, withAuth]);

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
        const wrapperClass = ["mb-3", cfg.className].filter(Boolean).join(
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
                            type: "link-view",
                        })}
                    </div>
                );
            default:
                // Fall back to integration widget-by-key renderer, then to generic widget.
                return (
                    <div key={baseKey} className={wrapperClass}>
                        {renderWidget({
                            type: entryKey,
                            consumerKey: typeof cfg.configKey === "string" && cfg.configKey.trim()
                                ? cfg.configKey.trim()
                                : undefined,
                            params: cfg,
                            className: wrapperClass,
                        })}
                    </div>
                );
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
        return (
            <div
                key={columnName}
                id={COLUMN_PANEL_IDS[columnName]}
                className={COLUMN_CLASSNAME[columnName]}
                style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
            >
                {isLoading
                    ? (
                        renderColumnSkeleton(columnName)
                    )
                    : (
                        entries && typeof entries === "object"
                            ? sortWidgetEntries(entries).map(([key, cfg], i) =>
                                renderWidgetEntry(
                                    columnName,
                                    key,
                                    cfg as Record<string, any>,
                                    i,
                                )
                            )
                            : null
                    )}
            </div>
        );
    };

    return (
        <>
            <div className="grid grid-rows-[minmax(0,1fr)_36px] h-dvh pt-5 p-2 overflow-x-hidden text-(--surface-foreground) bg-(--surface)">
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
    const { user, token, withAuth } = useAuth();
    const [unreadCount, setUnreadCount] = useState<number>(0);
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
                        to="/notifications"
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
