"use client";

import { useConfig } from "@/context/ConfigContext";
import ClockWidget from "../widgets/ClockWidget";
import SearchBar from "../widgets/SearchBar";
import LinkView from "../widgets/LinkView";
import GlanceableComponent from "../glanceables/Glanceable";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BottomNavbar from "./BottomNavbar";
import useAuth from "@/context/useAuth";
import Screensaver from "./Screensaver";
import WidgetComponent from "../widgets/Widget";

export default function DashboardLayoutComponent(
  children: React.PropsWithChildren<{}> = {}
) {
  const { config, refreshConfig } = useConfig();
  const router = useRouter();
  const searchParams = useSearchParams();
  const openFromURL = searchParams.get("search") === "1";
  const [isScreensaverActive, setScreensaverActive] = useState(false);

  const { token } = useAuth();

  useEffect(() => {
    if (!token) router.push("/auth/login");
  }, [router, token]);

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


  return (
    <>
      <Screensaver active={isScreensaverActive} onExit={() => setScreensaverActive(false)} />
      <div className="grid grid-rows-[1fr_36px] h-dvh pt-5 md:p-3.5 p-0 overflow-x-hidden text-(--surface-foreground) bg-(--surface)">
        <main
          id="page-content-container"
          ref={containerRef}
          className="
          /* mobile: horizontal swipe panels */
          flex snap-x snap-mandatory overflow-x-auto touch-pan-x scrollbar-hide overflow-y-scroll
          md:grid md:grid-cols-[25%_1fr_25%] min-h-0
        "
        >
          <div
            id="left-widget-panel"
            className="flex-shrink-0 w-screen snap-start md:w-auto md:flex-grow md:basis-auto space-y-3.5 overflow-y-auto min-w-0"
            style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
          >
            {renderWidgetColumn(config?.widgets?.[0])}
          </div>

          <div className="flex-shrink-0 w-screen snap-start md:w-auto md:flex-grow md:basis-auto space-y-3.5 overflow-x-hidden min-w-0 px-2" style={{ scrollSnapStop: "always", touchAction: "pan-x" }}>
            <section className="responsive-glance-grid w-full">
              {/* Clock (grid-area: clock) */}
              <div
                style={{ gridArea: "clock" }}
                className="area-clock w-full flex items-center justify-center text-2xl md:text-4xl leading-tight"
              >
                {/* ensure the widget itself is centered, even if it renders full-width elements */}
                <div style={{ margin: "0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <ClockWidget 
                    format={(config?.global?.["time-format"] as "12h" | "24h") || "24h"} 
                    font={config?.appearance?.clock?.defaultFont}
                  />
                </div>
              </div>


              {/* Left glanceable (grid-area: gl1) */}
              <div style={{ gridArea: "gl1" }} className="area-gl1">
                <GlanceableComponent
                  type={config?.glanceables?.[0]?.type}
                  params={config?.glanceables?.[0]?.properties}
                  className="font-medium"
                />
              </div>

              {/* Right glanceable (grid-area: gl2) */}
              <div style={{ gridArea: "gl2" }} className="area-gl2">
                <GlanceableComponent
                  type={config?.glanceables?.[1]?.type}
                  params={config?.glanceables?.[1]?.properties}
                  className="font-medium"
                />
              </div>
            </section>

            <SearchBar useRedirect={true} defaultOpen={openFromURL ?? false}/>
            <LinkView />
            {/* Render middle column widgets */}
            {renderWidgetColumn(config?.widgets?.[1])}
          </div>
          <div
            id="right-widget-panel"
            className="flex-shrink-0 w-screen snap-start md:w-auto md:flex-grow md:basis-auto space-y-3.5 overflow-y-auto min-w-0"
            style={{ scrollSnapStop: "always", touchAction: "pan-x" }}
          >
            {renderWidgetColumn(config?.widgets?.[2])}
          </div>
        </main >

        <BottomNavbar
          activePanel={activePanel}
          setScreensaverActive={setScreensaverActive}
        />
      </div >
    </>
  );
}

