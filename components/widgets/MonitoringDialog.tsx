"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LinkType } from "./LinkView";

type JobEntry = {
    status: string;
    dateChanged: string | null;
    durationChanged: number | null;
};

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    link: LinkType;
    details?: JobEntry;
}

export default function MonitoringDialogComponent({
    open,
    onOpenChange,
    link,
    details
}: Props) {

    const latest = details?.status ?? "unknown";
    const latestChange = details?.dateChanged ? new Date(details.dateChanged) : null;

    const prevStart =
        latestChange && details?.durationChanged
            ? new Date(latestChange.getTime() - details.durationChanged * 1000)
            : null;

    const fmt = (d: Date | null) => d ? d.toLocaleString() : "—";
    const fmtDur = (s?: number | null) => s == null ? "—" : `${Number(s).toFixed(1)}s`;

    const dotColor = latest === "healthy"
        ? "bg-green-400"
        : latest === "disabled"
            ? "bg-gray-400"
            : "bg-red-400";

    // ✅ Extract a readable site name from URL
    const siteName = link.name;

    // ✅ Show endpoint for GET request
    const statusEndpoint = `/api/status?id=${encodeURIComponent(link.id ?? "")}`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[min(680px,96%)] frosted text-(--text-primary) [&>button]:hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-between">
                        <div>
                            Monitoring details for <span className="font-semibold">{siteName}</span>
                        </div>
                    </DialogTitle>
                </DialogHeader>

                <div className="mt-4 space-y-2">

                    <div className="flex items-center gap-3">
                        <div className={`h-3 w-3 rounded-full ${dotColor}`} />
                        <div className="text-sm font-medium">Current status: {latest}</div>
                    </div>

                    {link.url && (
                        <div className="flex items-center justify-between">
                            <div className="font-medium text-sm ">Monitored Endpoint (from server):</div>
                            <code className="text-[11px] block mt-2 p-2 rounded-md bg-black/20 font-mono">
                                GET {link.url}
                            </code>
                        </div>
                    )}

                    <div className="text-xs">
                        <div className="font-semibold mb-1">Last downtime:</div>
                        {prevStart ? (
                            <div>
                                <span className="text-red-400">{fmt(prevStart)}</span>{" → "}
                                <span className="text-green-400">{fmt(latestChange)}</span>
                                <span className="opacity-70 ml-1">
                                    ({fmtDur(details?.durationChanged)})
                                </span>
                            </div>
                        ) : (
                            <div>No downtime recorded</div>
                        )}
                    </div>

                    {/* Open monitored site */}
                    <div className="flex justify-end pt-2">
                         <DialogClose asChild>
                            <Button variant="secondary" size="sm">Close</Button>
                        </DialogClose>
                    </div>

                </div>
            </DialogContent>
        </Dialog>
    );
}
