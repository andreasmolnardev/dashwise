"use client";

import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Icon } from "@iconify-icon/react";

export default function MonitoringHomePage() {
    const [searchParams, setSearchParams] = useSearchParams();

    const openMonitorDialog = () => {
        const next = new URLSearchParams(searchParams);
        next.set("newMonitor", "true");
        setSearchParams(next);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <h1 className="text-3xl font-semibold tracking-tight">
                    Overview
                </h1>

                <Button onClick={openMonitorDialog} className="gap-2">
                    <Icon icon="fa6-solid:plus" className="text-xs" />
                    Add Monitor
                </Button>
            </div>

            <div className="rounded-3xl frosted border border-white/10 p-6">
                <h2 className="text-xl font-semibold">No monitor selected</h2>
                <p className="mt-2 text-sm text-white/60">
                    Your monitored endpoints appear in the sidebar once they are
                    indexed. If you don’t see any monitors yet, make sure status
                    checking is enabled for your links.
                </p>
                <div className="mt-4">
                    <Button variant="secondary" onClick={openMonitorDialog} className="gap-2">
                        <Icon icon="fa6-solid:plus" className="text-xs" />
                        Add Monitor
                    </Button>
                </div>
            </div>
        </div>
    );
}
