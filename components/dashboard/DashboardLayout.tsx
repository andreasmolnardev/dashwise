"use client";

import { usePageConfig } from "@/hooks/usePageConfig";
import ClockWidget from "../widgets/ClockWidget";
import SearchBar from "../widgets/SearchBar";
import LinkView from "../widgets/LinkView";
import GlanceableComponent from "../glanceables/Glanceable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BottomNavbar from "./BottomNavbar";
import useAuth from "@/context/useAuth";
import Screensaver from "./Screensaver";
import WidgetComponent from "../widgets/Widget";

const DASHBOARD_COLUMN_ORDER = ["left", "middle", "right"] as const;
type DashboardColumn = (typeof DASHBOARD_COLUMN_ORDER)[number];

const COLUMN_CLASSNAME: Record<DashboardColumn, string> = {
  left: "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-y-visible min-w-0 min-h-0 h-fit p-1",
  middle: "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-x-hidden min-w-0 min-h-0 h-fit p-1",
  right: "flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-y-visible min-w-0 min-h-0 h-fit p-1",
};

const COLUMN_PANEL_IDS: Record<DashboardColumn, string | undefined> = {
  left: "left-widget-panel",
  middle: undefined,
  right: "right-widget-panel",
};

const COLUMN_WIDGET_INDEX: Record<DashboardColumn, number> = {
  left: 0,
  middle: 1,
  right: 2,
};

export default function DashboardLayoutComponent(
  children: React.PropsWithChildren<{}> = {}
) {
  const { config } = usePageConfig();
  const router = useRouter();
  const searchParams = useSearchParams();
  const openFromURL = searchParams.get("search") === "1";
  const [isScreensaverActive, setScreensaverActive] = useState(false);

  const { token } = useAuth();

  useEffect(() => {
    if (!token) router.push("/auth/login");
  }, [router, token]);

  const shouldShowOnboarding = config?.meta?.onboard === true;

  useEffect(() => {
    if (shouldShowOnboarding) {
      router.replace("/onboarding");
    }
  }, [shouldShowOnboarding, router]);

  const [localScreensaverConfig, setLocalScreensaverConfig] = useState<any>(null);

  useEffect(() => {
    const checkLocal = () => {
      const local = localStorage.getItem("dashwise_screensaver_local");
      if (local) {
        setLocalScreensaverConfig(JSON.parse(local));
      } else {
        setLocalScreensaverConfig(null);
      }
    };

    checkLocal();
    window.addEventListener("dashwise_local_config_updated", checkLocal);
    return () => window.removeEventListener("dashwise_local_config_updated", checkLocal);
  }, []);

  useEffect(() => {
    let inactivityTimer: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      const screensaverConfig = localScreensaverConfig || config.appearance?.screensaver;
      const timeout = screensaverConfig?.inactivityTimeout;
      if (timeout && timeout > 0) {
        inactivityTimer = setTimeout(() => {
          setScreensaverActive(true);
        }, timeout * 1000);
      }
    };

    const userActivityEvents = ["mousemove", "keydown", "scroll"];
    userActivityEvents.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
      clearTimeout(inactivityTimer);
      userActivityEvents.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [config.appearance?.screensaver?.inactivityTimeout]);

  if (!token) return null;
  if (shouldShowOnboarding) return null;

  useEffect(() => {
    router.prefetch("/settings/appearance");
  }, [router]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activePanel, setActivePanel] = useState<number>(1); // 0=left,1=center,2=right

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;
    const onScroll = () => {
      // round to nearest panel based on clientWidth
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = el.clientWidth || window.innerWidth;
        const idx = Math.round(el.scrollLeft / width);
        setActivePanel(Math.min(2, Math.max(0, idx)));
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    // set initial position
    onScroll();

    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [containerRef]);

  // scroll to center panel on first render (mobile only)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isMobile = window.innerWidth < 768;
    if (!isMobile) return;

    // Wait a frame so layout has measured widths
    requestAnimationFrame(() => {
      try {
        const width = el.clientWidth || window.innerWidth;
        el.scrollTo({ left: width * 1, behavior: "auto" }); // center panel (index 1)
        setActivePanel(1);
      } catch { }
    });
  }, [containerRef]);

  // mobile: velocity-aware snap that allows faster flicks to travel further
  // mobile: velocity-aware snap that respects horizontal children
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

    const findHorizontallyScrollable = (node: Element | null): HTMLElement | null => {
      while (node && node !== el) {
        const n = node as HTMLElement;
        const style = getComputedStyle(n);
        const canScroll = n.scrollWidth > n.clientWidth + 1;
        if (canScroll && style.overflowX !== "hidden") return n;
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
        childCanScrollRight = childScrollable.scrollLeft + childScrollable.clientWidth < childScrollable.scrollWidth - 1;
      } else {
        childCanScrollLeft = childCanScrollRight = false;
      }
      if (rafId) cancelAnimationFrame(rafId);
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const endX = e.changedTouches[0].clientX;
      const dx = startX - endX;
      const dt = Math.max(1, e.timeStamp - startTime);
      const velocity = dx / dt;

      // If child can scroll in gesture direction → do not snap parent
      if (childScrollable) {
        if (dx > 0 && childCanScrollRight) return; // swipe left
        if (dx < 0 && childCanScrollLeft) return;  // swipe right
      }

      const width = el.clientWidth || window.innerWidth;

      // velocity-based projection
      let projected = el.scrollLeft + velocity * 250;

      // fallback: distance-based guess
      const baseIdx = Math.round(el.scrollLeft / width);
      const distanceIdx = baseIdx + (dx > 0 ? 1 : -1);

      // whichever is CLOSEST to current scroll
      let idx = Math.round(projected / width);

      // if scrolling slowly → ignore velocity, use distance
      if (Math.abs(dx) < width * 0.3) {
        idx = distanceIdx;
      }

      idx = Math.max(0, Math.min(idx, Math.ceil(el.scrollWidth / width) - 1));

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
  }, [containerRef]);

  const renderWidgetColumn = (column?: typeof config.widgets[0]) => {
    if (!column) return null;
    return column.map((widget, index) => (
      <WidgetComponent
        key={widget.id || `${widget.type}-${index}`}
        type={widget.type}
        params={widget.properties}
        className={`mb-3.5 ${widget.type === "placeholder" ? "hidden md:block md:invisible md:h-[92px]" : ""}`}
      />
    ));
  };


  const layoutSource =
    typeof config?.layout === "object" && config?.layout !== null
      ? config.layout
      : config?.template || config?.columns
        ? { template: config.template, columns: config.columns }
        : undefined;

  const layoutColumns = (layoutSource?.columns ?? undefined) as Record<string, Record<string, any>> | undefined;
  const layoutTemplate = layoutSource?.template;
  const hasRequiredColumns =
    layoutColumns &&
    DASHBOARD_COLUMN_ORDER.every((columnName) => typeof layoutColumns[columnName] === "object");
  const shouldUseTemplateLayout = layoutTemplate === "main" && Boolean(layoutColumns) && hasRequiredColumns;
  const layoutColumnsRecord = shouldUseTemplateLayout
    ? (layoutColumns as Record<DashboardColumn, Record<string, any>>)
    : undefined;

  const defaultGlanceables = config?.glanceables ?? [];
  const defaultGlanceableMap = useMemo(() => {
    return new Map(
      defaultGlanceables
        .filter((entry): entry is Record<string, any> => !!entry?.type)
        .map((entry) => [entry.type, entry])
    );
  }, [defaultGlanceables]);
  const defaultGlanceableOrder = defaultGlanceables.map((entry) => entry.type);

  const heightRefs = useRef<Record<string, HTMLElement | null>>({});
  const heightRefCallbacks = useRef<Record<string, (node: HTMLElement | null) => void>>({});
  const [heightRefVersion, setHeightRefVersion] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});

  const getHeightRefCallback = useCallback((key: string) => {
    if (!heightRefCallbacks.current[key]) {
      heightRefCallbacks.current[key] = (node: HTMLElement | null) => {
        if (heightRefs.current[key] === node) return;
        heightRefs.current[key] = node;
        setHeightRefVersion((value) => value + 1);
      };
    }
    return heightRefCallbacks.current[key];
  }, []);

  const referencedHeightKeys = useMemo(() => {
    if (!shouldUseTemplateLayout || !layoutColumnsRecord) return [];
    const keys = new Set<string>();
    for (const column of Object.values(layoutColumnsRecord)) {
      if (!column || typeof column !== "object") continue;
      for (const entryConfig of Object.values(column)) {
        const heightValue = entryConfig?.height;
        if (typeof heightValue === "string" && heightValue.startsWith("$")) {
          keys.add(heightValue.slice(1));
        }
      }
    }
    return Array.from(keys);
  }, [layoutColumnsRecord, shouldUseTemplateLayout]);

  const referencedHeightKeyString = referencedHeightKeys.join("|");

  useEffect(() => {
    if (!shouldUseTemplateLayout || referencedHeightKeys.length === 0) {
      setMeasuredHeights((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    if (typeof ResizeObserver === "undefined") return;

    const observers = new Map<string, ResizeObserver>();
    referencedHeightKeys.forEach((key) => {
      const node = heightRefs.current[key];
      if (!node) return;
      const measure = () => {
        const nextHeight = Math.round(node.getBoundingClientRect().height);
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

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [shouldUseTemplateLayout, referencedHeightKeyString, heightRefVersion]);

  const layoutStyleVars = useMemo<CSSProperties | undefined>(() => {
    if (!shouldUseTemplateLayout || Object.keys(measuredHeights).length === 0) {
      return undefined;
    }
    const cssVars = {} as CSSProperties;
    for (const [key, value] of Object.entries(measuredHeights)) {
      (cssVars as Record<string, string>)[`--layout-${key}`] = `${value}px`;
    }
    return cssVars;
  }, [shouldUseTemplateLayout, measuredHeights]);

  const renderTemplateEntry = (
    columnName: DashboardColumn,
    entryKey: string,
    entryConfig: Record<string, any> | null | undefined,
    entryIndex: number
  ) => {
    const configObject = entryConfig ?? {};
    const wrapperClass = ["mb-3.5", configObject.className].filter(Boolean).join(" ");
    const baseKey = `${columnName}-${entryKey}-${entryIndex}`;

    switch (entryKey) {
      case "placeholder": {
        const heightValue = configObject.height;
        let heightStyle: string | undefined;
        if (typeof heightValue === "string") {
          heightStyle = heightValue.startsWith("$")
            ? `var(--layout-${heightValue.slice(1)})`
            : heightValue;
        } else if (typeof heightValue === "number") {
          heightStyle = `${heightValue}px`;
        }
        return (
          <div key={baseKey} className={wrapperClass} style={heightStyle ? { height: heightStyle } : undefined}>
            <WidgetComponent
              type="placeholder"
              params={configObject.params}
              className="h-full w-full"
            />
          </div>
        );
      }
      case "main-clock": {
        const mainClockRef = getHeightRefCallback("main-clock");
        const glanceableOverrides = configObject?.glanceables;
        const glanceableKeys =
          glanceableOverrides && Object.keys(glanceableOverrides).length > 0
            ? Object.keys(glanceableOverrides)
            : defaultGlanceableOrder;

        const getGlanceableParams = (type?: string) => {
          if (!type) return undefined;
          const override = glanceableOverrides?.[type];
          if (override && typeof override === "object") return override;
          const fallback = defaultGlanceableMap.get(type);
          if (!fallback) return undefined;
          const { type: _ignore, ...rest } = fallback;
          return Object.keys(rest).length > 0 ? rest : undefined;
        };

        return (
          <div key={baseKey} className={wrapperClass} ref={mainClockRef}>
            <section className="responsive-glance-grid w-full">
              <div
                style={{ gridArea: "clock" }}
                className="area-clock w-full flex items-center justify-center text-2xl md:text-4xl leading-tight"
              >
                <div style={{ margin: "0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <ClockWidget font={config?.appearance?.clock?.defaultFont} />
                </div>
              </div>

              <div style={{ gridArea: "gl1" }} className="area-gl1">
                {glanceableKeys[0] && (
                  <GlanceableComponent
                    type={glanceableKeys[0]}
                    params={getGlanceableParams(glanceableKeys[0])}
                    className="font-medium"
                  />
                )}
              </div>

              <div style={{ gridArea: "gl2" }} className="area-gl2">
                {glanceableKeys[1] && (
                  <GlanceableComponent
                    type={glanceableKeys[1]}
                    params={getGlanceableParams(glanceableKeys[1])}
                    className="font-medium"
                  />
                )}
              </div>
            </section>
          </div>
        );
      }
      case "search-bar":
        return (
          <div key={baseKey} className={wrapperClass}>
            <SearchBar useRedirect={true} defaultOpen={openFromURL ?? false} />
          </div>
        );
      case "link-view":
        return (
          <div key={baseKey} className={wrapperClass}>
            <LinkView />
          </div>
        );
      default:
        return null;
    }
  };

  const renderTemplateColumn = (columnName: DashboardColumn) => {
    const entries = layoutColumnsRecord?.[columnName];
    const entryNodes =
      entries && typeof entries === "object"
        ? Object.entries(entries).map(([entryKey, entryConfig], index) =>
            renderTemplateEntry(columnName, entryKey, entryConfig, index)
          )
        : null;

    return (
      <div
        key={columnName}
        id={COLUMN_PANEL_IDS[columnName]}
        className={COLUMN_CLASSNAME[columnName]}
        style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
      >
        {entryNodes}
        {renderWidgetColumn(config?.widgets?.[COLUMN_WIDGET_INDEX[columnName]])}
      </div>
    );
  };

  const renderTemplateColumns = () => DASHBOARD_COLUMN_ORDER.map((columnName) => renderTemplateColumn(columnName));

  const renderLegacyColumns = () => (
    <>
      <div
        id="left-widget-panel"
        className="flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-y-visible min-w-0 min-h-0 h-fit p-1"
        style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
      >
        {renderWidgetColumn(config?.widgets?.[0])}
      </div>

      <div
        className="flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-x-hidden min-w-0 min-h-0 h-fit p-1"
        style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
      >
        <section className="responsive-glance-grid w-full">
          <div
            style={{ gridArea: "clock" }}
            className="area-clock w-full flex items-center justify-center text-2xl md:text-4xl leading-tight"
          >
            <div style={{ margin: "0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <ClockWidget font={config?.appearance?.clock?.defaultFont} />
            </div>
          </div>

          <div style={{ gridArea: "gl1" }} className="area-gl1">
            <GlanceableComponent
              type={config?.glanceables?.[0]?.type}
              params={config?.glanceables?.[0]?.properties}
              className="font-medium"
            />
          </div>

          <div style={{ gridArea: "gl2" }} className="area-gl2">
            <GlanceableComponent
              type={config?.glanceables?.[1]?.type}
              params={config?.glanceables?.[1]?.properties}
              className="font-medium"
            />
          </div>
        </section>

        <SearchBar useRedirect={true} defaultOpen={openFromURL ?? false} />
        <LinkView />
        {renderWidgetColumn(config?.widgets?.[1])}
      </div>
      <div
        id="right-widget-panel"
        className="flex-shrink-0 w-screen snap-start md:w-auto md:basis-auto space-y-3.5 overflow-y-visible min-w-0 min-h-0 h-fit p-1"
        style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
      >
        {renderWidgetColumn(config?.widgets?.[2])}
      </div>
    </>
  );

  const columnsContent = shouldUseTemplateLayout ? renderTemplateColumns() : renderLegacyColumns();
  const pageContentStyle = shouldUseTemplateLayout ? layoutStyleVars : undefined;

  return (
    <>
      <Screensaver active={isScreensaverActive} onExit={() => setScreensaverActive(false)} />
      <div className="grid grid-rows-[minmax(0,1fr)_36px] h-dvh pt-5 md:p-3.5 p-0 overflow-x-hidden text-(--surface-foreground) bg-(--surface)">
        <main
          id="page-content-container"
          ref={containerRef}
          className="
          /* mobile: horizontal swipe panels */
          flex snap-x snap-mandatory overflow-x-auto touch-pan-x overflow-y-auto scrollbar-hidden md:scrollbar-auto md:overflow-x-hidden
          md:grid md:grid-cols-[25%_1fr_25%] min-h-0
        "
          style={pageContentStyle}
        >
          {columnsContent}
        </main >

        <BottomNavbar
          activePanel={activePanel}
          setScreensaverActive={setScreensaverActive}
        />
      </div >
    </>
  );
}

