"use client";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogClose
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LinkType } from "@dashwise/types/sdk";
import useAuth from "@/context/useAuth";
import { useState } from "react";
import { Icon } from "@iconify-icon/react";
import { updateMonitoringStatusAction } from '@/lib/apiClient';
import MonitoringTimeline from "@/components/monitoring/MonitoringTimeline";

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

    const currentStatus = details?.status ?? "unhealthy";
    const changeTime = details?.dateChanged ? new Date(details.dateChanged) : null;

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

    const siteName = link.title || link.url || "Monitor";
    const monitoredEndpoint = lastCheckInfo?.endpoint || details?.endpoint || link.url;
    const monitoredMethod = "GET";

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
            ) as any;
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
                    <MonitoringTimeline
                        status={currentStatus}
                        dateChanged={details?.dateChanged ?? null}
                        durationChanged={details?.durationChanged ?? null}
                    />

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