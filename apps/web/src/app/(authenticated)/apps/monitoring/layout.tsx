"use client";

import { Outlet, useSearchParams } from "react-router-dom";
import { useState } from "react";
import AppTemplate, { BottomTab, Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";
import { getMonitorsAction } from '@/lib/apiClient';
import { getMonitoringHostsAction, getSdkMonitoringResourcesAction } from '@/lib/apiClient';
import type { MonitorRecord, MonitoringHostRecord } from '@/lib/apiClient';
import { useActivity } from "@/context/ActivityContext";
import config from "@/lib/config";
import AddMonitoringResourceDialog from "@/components/monitoring/AddMonitoringResourceDialog";
import SystemAgentHostDialog from "@/components/monitoring/SystemAgentHostDialog";
import { useMonitoringLinkLookup } from "@/components/monitoring/useMonitoringLinkLookup";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";

export default function MonitoringRootLayout() {
    const queryClient = useQueryClient();
    const { token } = useAuth();
    const { unreadCount } = useActivity();
    const [systemAgentDialogOpen, setSystemAgentDialogOpen] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const { entryById } = useMonitoringLinkLookup();

    const monitorsQuery = useApiQuery(queryKeys.monitoring.monitors, getMonitorsAction);
    const hostsQuery = useApiQuery(queryKeys.monitoring.hosts, getMonitoringHostsAction);
    const sdkResourcesQuery = useApiQuery(queryKeys.monitoring.sdkResources, getSdkMonitoringResourcesAction);
    const monitors = (monitorsQuery.data ?? []) as MonitorRecord[];
    const hosts = (hostsQuery.data ?? []) as MonitoringHostRecord[];
    const sdkResources = sdkResourcesQuery.data ?? [];

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

    return (
        <AppTemplate title="Monitoring">
             <Sidebar>
                 <Tab
                     dst="/apps/monitoring"
                     icon="fa6-solid:gauge-high"
                     title="Overview"
                     isRoot
                 />
                 
                  <BottomTab
                      dst="/apps/monitoring/notifications"
                      icon="fa6-solid:bell"
                      title="Notifications"
                      isRoot
                      badge={unreadCount > 0 ? unreadCount : undefined}
                  />

                <GroupLabel
                    group="Monitors"
                    title="Monitors"
                    collapsible
                    collapsed
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
                        title={monitor.expand?.sourcelinkId?.title || entry?.title || monitor.endpoint || monitor.sourcelinkId || monitor.source || monitor.id}
                        group="Monitors"
                        badge={monitor.status ? monitor.status : undefined}
                    />
                        );
                    })()
                ))}

                <GroupLabel group="Hosts" title="Hosts" collapsible collapsed actions={[{ icon: "fa6-solid:plus", title: "Connect System Agent", action: () => setSystemAgentDialogOpen(true) }]} />
                {hosts.map((host) => (
                    <Tab key={host.id} dst={`/apps/monitoring/hosts/${host.id}`} icon="fa6-solid:hard-drive" title={host.name || host.hostname || host.id} group="Hosts" badge={host.status || undefined} />
                ))}

                {sdkResources.length > 0 && <GroupLabel group="Integrated systems" title="Integrated systems" collapsible collapsed />}
                {sdkResources.map((resource) => (
                    <Tab
                        key={`${resource.instanceId}:${resource.collectionId}:${resource.id}`}
                        dst={`/apps/monitoring/sdk/${encodeURIComponent(resource.instanceId)}/${encodeURIComponent(resource.collectionId)}/${encodeURIComponent(resource.id)}`}
                        icon={resource.icon || "fa6-solid:server"}
                        title={resource.name || resource.id}
                        group="Integrated systems"
                        badge={resource.state === "unavailable" || resource.state === "offline" ? "down" : undefined}
                    />
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
                    queryClient.setQueryData<MonitorRecord[]>(["api", token, ...queryKeys.monitoring.monitors], (current = []) => [monitor, ...current.filter((existing) => existing.id !== monitor.id)]);
                    closeMonitorDialog();
                }}
                onSystemAgentRequested={() => setSystemAgentDialogOpen(true)}
            />

            <SystemAgentHostDialog
                open={systemAgentDialogOpen}
                onOpenChange={setSystemAgentDialogOpen}
                onSaved={(host) => queryClient.setQueryData<MonitoringHostRecord[]>(["api", token, ...queryKeys.monitoring.hosts], (current = []) => [host, ...current.filter((existing) => existing.id !== host.id)])}
            />

        </AppTemplate>
    );
}
