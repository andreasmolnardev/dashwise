"use client";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogClose
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LinkType } from "./LinkView";
import useAuth from "@/context/useAuth";
import { useState } from "react";
import { Icon } from "@iconify-icon/react";
import { updateMonitoringStatusAction } from "@/app/actions/monitoring";

export type JobEntry = {
    status: "healthy" | "disabled" | "unhealthy";
    dateChanged: string | null;
    durationChanged: number | null; // seconds
    endpoint?: string;
};

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    link: LinkType;
    details?: JobEntry;
    onCheckTriggered?: () => Promise<void> | void;
}

export default function MonitoringDialogComponent({
    open,
    onOpenChange,
    link,
    details,
    onCheckTriggered,
}: Props) {
    const { token, withAuth } = useAuth();
    const [isChecking, setIsChecking] = useState(false);
    const [checkError, setCheckError] = useState<string | null>(null);
    const [lastCheckInfo, setLastCheckInfo] = useState<{
        status?: string;
        endpoint?: string;
        httpStatus?: number;
        checkedAt?: string;
    } | null>(null);

    const now = new Date();
    const currentStatus = details?.status ?? "unhealthy";
    const changeTime = details?.dateChanged ? new Date(details.dateChanged) : null;
    const changeDuration = details?.durationChanged ?? 0;

    // Determine current and previous states
    const isCurrentlyUp = currentStatus === "healthy";
    const currentState = isCurrentlyUp ? "up" : "down";

    // Calculate timeline segments
    type TimelineSegment = {
        type: "state" | "time" | "now";
        status?: "up" | "down";
        date?: Date;
        flex: number;
    };

    const segments: TimelineSegment[] = [];

    if (changeTime && changeDuration > 0) {
        // Previous state existed - show full 6-segment timeline
        const previousState = isCurrentlyUp ? "down" : "up";
        const previousStartTime = new Date(changeTime.getTime() - changeDuration * 1000);

        const currentDuration = now.getTime() - changeTime.getTime();
        const previousDurationMs = changeDuration * 1000;

        // Calculate flex weights based on duration comparison
        const longerFlex = 3;
        const shorterFlex = 2;
        const [beforeFlex, currentFlex] = currentDuration >= previousDurationMs
            ? [shorterFlex, longerFlex]
            : [longerFlex, shorterFlex];

        segments.push(
            { type: "state", status: currentState, flex: 1 }, // before-before state
            { type: "time", date: previousStartTime, flex: 0 }, // start of previous state
            { type: "state", status: previousState, flex: beforeFlex }, // previous state
            { type: "time", date: changeTime, flex: 0 }, // end of previous state
            { type: "state", status: currentState, flex: currentFlex }, // current state
            { type: "now", flex: 0 } // now marker
        );
    } else {
        // No previous state change - show 2-segment timeline
        segments.push(
            { type: "state", status: currentState, flex: 1 },
            { type: "now", flex: 0 }
        );
    }

    const formatDate = (date: Date) => {
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        return isToday
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
            date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Status indicator
    const statusText = currentStatus === "healthy" ? "Up" : "Down";
    const dotColor =
        currentStatus === "healthy" ? "bg-green-400" : currentStatus === "disabled" ? "bg-gray-400" : "bg-red-400";

    const siteName = link.name;
    const monitoredEndpoint = lastCheckInfo?.endpoint || details?.endpoint || link.statusCheckEndpoint || link.url;
    const monitoredMethod = link.statusCheckMethod || "GET";

    const triggerCheck = async () => {
        if (!token) {
            setCheckError("Not authenticated");
            return;
        }
        if (!link.id) {
            setCheckError("Missing link ID");
            return;
        }

        setIsChecking(true);
        setCheckError(null);
        try {
            const response = await withAuth((auth) =>
                updateMonitoringStatusAction(auth, { linkId: link.id })
            );
            setLastCheckInfo({
                status: response?.status,
                endpoint: response?.endpoint,
                httpStatus: response?.httpStatus,
                checkedAt: response?.checkedAt,
            });
            if (onCheckTriggered) {
                await onCheckTriggered();
            }
        } catch (error) {
            setCheckError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[min(680px,96%)] frosted text-foreground [&>button]:hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-between">
                        <span>Status for {siteName}</span>
                        <div className="flex items-center justify-end gap-2">
                        {lastCheckInfo?.status && (
                            <span className="text-xs text-gray-300">
                                Last on-demand: {lastCheckInfo.status}
                                {lastCheckInfo.httpStatus ? ` (HTTP ${lastCheckInfo.httpStatus})` : ""}
                            </span>
                        )}
                        <Button variant="secondary" size="sm" onClick={triggerCheck} disabled={isChecking}>
                            <Icon icon="fa6-solid:arrows-rotate" className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                    </DialogTitle>
                </DialogHeader>

                {/* STATUS OVERVIEW */}
                <div className="mt-4 space-y-4">
                    

                    {checkError && (
                        <p className="text-sm text-red-400">{checkError}</p>
                    )}

                    <div className="flex items-center gap-2 text-sm font-medium">
                        <div className={`h-3 w-3 rounded-full ${dotColor}`} />
                        {statusText} since {changeTime ? formatDate(changeTime) : "—"}
                    </div>

                    {/* Endpoint */}
                    {monitoredEndpoint && (
                        <div className="flex items-center justify-between">
                            <div className="font-medium text-sm">Monitored Endpoint (from server):</div>
                            <code className="text-[11px] px-2 py-1 rounded-md bg-black/20 font-mono">
                                {monitoredMethod} {monitoredEndpoint}
                            </code>
                        </div>
                    )}

                    {/* TIMELINE */}
                    <div>
                        <div className="text-sm font-semibold mb-2">Recent Activity</div>

                        <div className="flex items-stretch gap-1 h-8">
                            {segments.map((segment, i) => {
                                if (segment.type === "state") {
                                    const bgColor = segment.status === "up"
                                        ? "bg-green-500/40"
                                        : "bg-red-500/40";
                                    const label = segment.status === "up" ? "Up" : "Down";

                                    return (
                                        <div
                                            key={i}
                                            className={`frosted ${bgColor} border border-white/20 rounded flex items-center justify-center text-sm font-medium`}
                                            style={{ flex: segment.flex }}
                                        >
                                            {label}
                                        </div>
                                    );
                                }

                                if (segment.type === "time" && segment.date) {
                                    return (
                                        <div
                                            key={i}
                                            className="frosted bg-white/10 border border-white/30 rounded flex items-center justify-center px-1 text-sm font-medium whitespace-nowrap overflow-visible"
                                            style={{ minWidth: '14px', maxWidth: '14px' }}
                                            title={segment.date.toLocaleString()}
                                        >
                                            <span className="relative">
                                                {formatDate(segment.date)}
                                            </span>
                                        </div>
                                    );
                                }

                                if (segment.type === "now") {
                                    return (
                                        <div
                                            key={i}
                                            className="frosted bg-blue-500/30 border border-blue-400/50 rounded flex items-center justify-end px-0.5 text-sm font-semibold"
                                            style={{ minWidth: '14px', maxWidth: '14px' }}
                                        >
                                            Now
                                        </div>
                                    );
                                }

                                return null;
                            })}
                        </div>
                    </div>

                    {/* Close */}
                    <div className="flex justify-end pt-2">
                        <DialogClose asChild>
                            <Button variant="secondary" size="sm">
                                Close
                            </Button>
                        </DialogClose>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}