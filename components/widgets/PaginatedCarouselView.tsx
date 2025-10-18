"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";

interface PaginatedCarouselViewProps {
  children: React.ReactNode[];
  rowHeight?: number;
  minColWidth?: number;
  maxCols?: number;
}


export function PaginatedCarouselViewComponent({
  children,
  rowHeight = 90,
  minColWidth = 150,
  maxCols = 4,
}: PaginatedCarouselViewProps) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [currentPage, setCurrentPage] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);


  // Calculate rows & cols using the provided rowHeight and minColWidth
  useEffect(() => {
    const calc = () => {
      const availH = window.innerHeight * 0.6;
      const computedRows = Math.max(1, Math.floor(availH / rowHeight));
      setRows(Math.min(3, computedRows));

      const effectiveWidth = containerWidth || window.innerWidth;
      let computedCols = Math.max(1, Math.floor(effectiveWidth / minColWidth));

      computedCols = Math.min(computedCols, maxCols);

      setCols(computedCols);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [containerWidth, rowHeight, minColWidth, maxCols]);

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

  return (
    <div className="space-y-2">
      {/* carousel */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory gap-2"
      >
        {pages.map((page, pi) => (
          <div key={pi} className="flex-none w-full snap-center">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {page}
            </div>
          </div>
        ))}
      </div>

      {/* bullets */}
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
