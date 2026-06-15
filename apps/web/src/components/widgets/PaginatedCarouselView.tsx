"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";

interface PaginatedCarouselViewProps {
  children: React.ReactNode[];
  rowHeight?: number;
  minColWidth?: number;
  minCols?: number;
  maxCols?: number;
  maxRows?: number;
  className?: string;
}

export function PaginatedCarouselViewComponent({
  children,
  rowHeight = 90,
  minColWidth = 150,
  minCols = 2,
  maxCols = 4,
  maxRows = 3,
  className,
}: PaginatedCarouselViewProps) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [currentPage, setCurrentPage] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    update();

    const observer = typeof ResizeObserver !== "undefined" && containerRef.current
      ? new ResizeObserver(update)
      : null;

    if (containerRef.current) {
      observer?.observe(containerRef.current);
    }

    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const calc = () => {
      const availH = window.innerHeight * 0.6;
      const finalRows = Math.min(maxRows, Math.max(1, Math.floor(availH / rowHeight)));
      setRows(finalRows);

      const effectiveWidth = containerWidth || window.innerWidth;
      const widthBasedCols = Math.max(
        minCols,
        Math.floor(effectiveWidth / minColWidth),
      );
      let computedCols = maxCols
        ? Math.min(widthBasedCols, maxCols)
        : widthBasedCols;
      setCols(Math.max(1, computedCols));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [children.length, containerWidth, rowHeight, minColWidth, minCols, maxCols, maxRows]);

  const perPage = rows * cols;

  const pages = useMemo(() => {
    const arr: React.ReactNode[][] = [];
    for (let i = 0; i < children.length; i += perPage) {
      arr.push(children.slice(i, i + perPage));
    }
    return arr;
  }, [children, perPage]);

  const scrollTo = (i: number) => {
    if (!containerRef.current) return;
    containerRef.current.scrollTo({
      left: i * containerWidth,
      behavior: "smooth",
    });
  };

  const onScroll = () => {
    if (!containerRef.current) return;
    const idx = Math.round(containerRef.current.scrollLeft / containerWidth);
    if (idx !== currentPage) setCurrentPage(idx);
  };

  /* smoother snap on mobile */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || window.innerWidth >= 768) return;

    let raf: number | null = null;
    let timeout: number | null = null;
    let startX = 0;
    let startTime = 0;

    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startTime = e.timeStamp;
      if (raf) cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
    };

    const onEnd = (e: TouchEvent) => {
      const endX = e.changedTouches[0].clientX;
      const dx = startX - endX;
      const dt = Math.max(1, e.timeStamp - startTime);
      const velocity = dx / dt;

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

      raf = requestAnimationFrame(() => {
        timeout = window.setTimeout(() => {
          el.scrollTo({ left: idx * width, behavior: "smooth" });
          timeout = null;
        }, delay);
      });
    };


    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      if (raf) cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
    };
  }, [containerRef]);

  return (
    <div className={cn("space-y-2", className)}>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory gap-1.5"
        style={{
          touchAction: "pan-x",
          scrollSnapStop: "always",
        }}
      >
        {pages.map((page, pi) => (
          <div key={pi} className="flex-none w-full snap-center">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {page}
            </div>
          </div>
        ))}
      </div>

      {pages.length > 1 && (
        <div className="flex justify-center mt-2 space-x-2">
          {pages.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              className={cn(
                "w-2.5 h-2.5 rounded-full transition",
                i === currentPage ? "bg-white" : "bg-white/40 hover:bg-white/70"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
