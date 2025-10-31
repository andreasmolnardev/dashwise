import React, { useEffect, useState } from "react";
import { useConfig } from "@/context/ConfigContext";
import { cn } from "@/lib/utils";
import { PaginatedCarouselViewComponent } from "./PaginatedCarouselView";
import MonitoringDialog, { JobEntry } from "./MonitoringDialog";

export interface LinkType {
  id?: string;
  name?: string;
  url?: string;
  icon?: string;
  linkGroup?: string;
  statusCheck?: boolean; // whether this link is monitored by your server
}

export default function LinkView() {
  const { config } = useConfig();
  const [activeGroup, setActiveGroup] = useState<string>(config.linkGroups[0]);

  const filtered = config.links.filter((link: LinkType) => link.linkGroup === activeGroup);

  // statusMap stores simple booleans keyed by link.id (server-driven)
  const [statusMap, setStatusMap] = useState<Record<string, boolean>>({});

  // raw server map normalized and keyed by link id (e.g. 'tw6ljbcv96')
  const [monitoringDetails, setMonitoringDetails] = useState<Record<string, {
    status: string;
    dateChanged: string | null;
    durationChanged: number | null;
  }> | null>(null);

  // which link.id has its dialog open
  const [openDialogFor, setOpenDialogFor] = useState<string | null>(null);

  // Converts server status strings into boolean used for UI dots
  function serverStatusToBool(status?: string | null): boolean | undefined {
    if (status === undefined || status === null) return undefined;
    if (status === "healthy") return true;
    if (status === "disabled") return undefined;
    return false;
  }

  // Fetch monitoring statuses for all jobs visible to the user.
  // NOTE: API returns keys like "link tw6ljbcv96" — we normalize them to just the link id: "tw6ljbcv96".
  async function fetchMonitoringStatuses() {
    try {
      if (typeof window === "undefined") return;
      const token = localStorage.getItem("pb_token");
      if (!token) {
        // no token — clear details
        setMonitoringDetails(null);
        setStatusMap({});
        return;
      }

      const res = await fetch("/api/v1/monitoringStatus", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        console.warn("/api/v1/monitoringStatus returned:", await res.text());
        return;
      }

      const data = await res.json();

      // Normalize keys: API returns keys like "link <linkId>" — strip the "link " prefix
      const normalized: Record<string, any> = {};
      for (const [rawKey, entry] of Object.entries(data || {})) {
        const keyStr = String(rawKey);
        if (keyStr.startsWith("link ")) {
          const id = keyStr.slice(5); // remove the "link " prefix
          normalized[id] = entry;
        } else {
          // if it doesn't match the expected prefix, fall back to using the raw key as-is
          normalized[rawKey] = entry;
        }
      }

      setMonitoringDetails(normalized);

      // map to simple boolean status map keyed by linkId
      const next: Record<string, boolean> = {};
      for (const [linkId, entry] of Object.entries(normalized)) {
        next[linkId] = serverStatusToBool((entry as any).status) as boolean;
      }
      setStatusMap(next);
    } catch (err) {
      console.error("Failed to fetch monitoring statuses:", err);
    }
  }

  // Initial fetch + periodic polling (30s). No client favicon probes anywhere.
  useEffect(() => {
    let mounted = true;
    fetchMonitoringStatuses();

    const id = window.setInterval(() => {
      if (!mounted) return;
      fetchMonitoringStatuses();
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Find the full link object based on the ID in state
  const selectedLink = openDialogFor
    ? config.links.find((l: LinkType) => l.id === openDialogFor)
    : undefined;

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
        {filtered.map((link: LinkType) => {
          // server entry keyed by link.id after normalization
          const serverEntry = link.id && monitoringDetails ? monitoringDetails[link.id] : undefined;

          // use explicit server status strings for dot logic
          const serverStatus = serverEntry?.status;
          const isHealthy = serverStatus === "healthy";
          const isDisabled = serverStatus === "disabled";

          const showDot = Boolean(link.statusCheck);

          return (
            <a
              key={link.id || link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center justify-between space-y-2 frosted rounded-2xl p-2 hover:text-(primary) transition-colors min-h-18 w-full"
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

              {/* Name on left, dot on right — dot opens dialog when clicked */}
              <div className="flex items-center w-full justify-center">
                <span className="text-sm text-white">{link.name}</span>

                {showDot ? (
                  <button
                    aria-label={`Show monitoring details for ${link.name}`}
                    title={`Show monitoring details for ${link.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (link.id && monitoringDetails && monitoringDetails[link.id]) {
                        setOpenDialogFor(link.id);
                      }
                    }}
                    className="ml-2 flex items-center justify-center"
                  >
                    <span
                      className="h-2 w-2 rounded-full inline-block hover:cursor-pointer hover:ring-2"
                      style={{
                        backgroundColor: isHealthy
                          ? "var(--primary)"
                          : isDisabled
                            ? "#9CA3AF"
                            : "#6B7280",
                      }}
                      aria-hidden
                    />
                  </button>
                ) : null}
              </div>
            </a>
          );
        })}
      </PaginatedCarouselViewComponent>

      {/* Monitoring dialog (opens when clicking a monitored link's dot) */}
      {selectedLink && (
        <MonitoringDialog
          open={!!selectedLink}
          onOpenChange={(val) => {
            if (!val) setOpenDialogFor(null);
          }}
          link={selectedLink}
          details={
            selectedLink.id && monitoringDetails
              ? (monitoringDetails[selectedLink.id] as JobEntry)
              : undefined
          }
        />
      )}
    </div>
  );
}
