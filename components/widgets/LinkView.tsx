
import { useConfig } from "@/context/ConfigContext";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { PaginatedCarouselViewComponent } from "./PaginatedCarouselView";

export default function LinkView() {
  const { config } = useConfig();
  const [activeGroup, setActiveGroup] = useState(config.linkGroups[0]);

  const filtered = config.links.filter(
    (link) => link.linkGroup === activeGroup
  );

  return (
    <div className="space-y-2">
      {/* GROUP BUTTONS */}
      <div className="flex gap-2">
        {config.linkGroups.map((g) => (
          <button
            key={g}
            onClick={() => setActiveGroup(g)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition",
              activeGroup === g
                ? "bg-white/20 backdrop-blur-md text-white border border-(--primary)"
                : "bg-white/10 text-gray-100 hover:bg-white/20"
            )}
          >
            {g}
          </button>
        ))}
      </div>

      {/* PAGINATED LINKS */}
      <PaginatedCarouselViewComponent minColWidth={140}>
        {filtered.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 hover:text-(primary) transition-colors min-h-18"
          >
            <div
              className="h-[35px] w-[35px] bg-white group-hover:bg-(--primary) transition"
              style={{
                maskImage: `url(${link.icon})`,
                WebkitMaskImage: `url(${link.icon})`,
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
                maskPosition: "center",
                WebkitMaskPosition: "center",
                maskSize: "contain",
                WebkitMaskSize: "contain",
              }}
            />
            <span className="text-sm text-white">{link.name}</span>
          </a>
        ))}
      </PaginatedCarouselViewComponent>
    </div>
  );
}
