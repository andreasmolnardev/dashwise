"use client";

import { Outlet, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import AppTemplate, { Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";
import useAuth from "@/context/useAuth";
import { getMonitorsAction } from "@/app/actions/monitoring";
import type { MonitorRecord } from "@/app/actions/monitoring";
import AddMonitoringResourceDialog from "@/components/monitoring/AddMonitoringResourceDialog";
import { useMonitoringLinkLookup } from "@/components/monitoring/useMonitoringLinkLookup";

export default function MonitoringRootLayout() {
    const { token, withAuth } = useAuth();
    const [monitors, setMonitors] = useState<MonitorRecord[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const { entryById } = useMonitoringLinkLookup();

    const monitorDialogOpen = searchParams.get("newMonitor") === "true";

    const openMonitorDialog = () => {
        const next = new URLSearchParams(searchParams);
        next.set("newMonitor", "true");
        setSearchParams(next);
    };

    const closeMonitorDialog = () => {
        const next = new URLSearchParams(searchParams);
        next.delete("newMonitor");
        setSearchParams(next);
    };

    useEffect(() => {
        if (!token) {
            setMonitors([]);
            return;
        }

        let mounted = true;

        const loadMonitors = async () => {
            try {
                const monitorList = await withAuth((auth) => getMonitorsAction(auth));
                if (!mounted) return;
                setMonitors(Array.isArray(monitorList) ? monitorList : []);
            } catch (err) {
                console.error("Failed to load monitors:", err);
                if (mounted) {
                    setMonitors([]);
                }
            }
        };

        loadMonitors();

        return () => {
            mounted = false;
        };
    }, [token, withAuth]);

    return (
        <AppTemplate title="Monitoring">
            <Sidebar>
                <Tab
                    dst="/apps/monitoring"
                    icon="fa6-solid:gauge-high"
                    title="Overview"
                    isRoot
                />

                <GroupLabel
                    group="Monitors"
                    title="Monitors"
                    actions={[{ icon: "fa6-solid:plus", title: "Add Monitor", action: openMonitorDialog }]}
                />

                {monitors.map((monitor) => (
                    (() => {
                        const entry = entryById.get(String(monitor.sourcelinkId || monitor.linkId || ""));
                        return (
                    <Tab
                        key={monitor.id}
                        dst={`/apps/monitoring/${monitor.id}`}
                        icon="fa6-solid:server"
                        title={entry?.title || monitor.endpoint || monitor.sourcelinkId || monitor.source || monitor.id}
                        group="Monitors"
                        badge={monitor.status ? monitor.status : undefined}
                    />
                        );
                    })()
                ))}
            </Sidebar>

            <Content>
                <Outlet />
            </Content>

            <AddMonitoringResourceDialog
                open={monitorDialogOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        closeMonitorDialog();
                    } else {
                        openMonitorDialog();
                    }
                }}
                onCreated={(monitor) => {
                    setMonitors((current) => [monitor, ...current.filter((existing) => existing.id !== monitor.id)]);
                    closeMonitorDialog();
                }}
            />
        </AppTemplate>
    );
}
