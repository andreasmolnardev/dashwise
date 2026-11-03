"use client";

import { Outlet, useSearchParams } from "react-router-dom";
import { useState } from "react";
import AppTemplate, { BottomTab, Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";
import { getSdkMonitoringResourcesAction } from '@/lib/apiClient';
import type { ViewResourceQuery } from '@/lib/viewsApi';
import { useActivity } from "@/context/ActivityContext";
import AddMonitoringResourceDialog from "@/components/monitoring/AddMonitoringResourceDialog";
import SystemAgentHostDialog from "@/components/monitoring/SystemAgentHostDialog";
import { useMonitoringLinkLookup } from "@/components/monitoring/useMonitoringLinkLookup";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";
import { useResourceView } from "@/hooks/useResourceView";

const monitoredServicesView: ViewResourceQuery = {
    types: ["monitoring.service"],
    provider: "dashwise",
    providerInstanceId: "monitoring",
    capabilities: ["monitoring"],
    filters: [],
    search: "",
    orderBy: "updatedAt",
    limit: 200,
    offset: 0,
};

const monitoringHostsView: ViewResourceQuery = {
    ...monitoredServicesView,
    types: ["monitoring.host"],
};

export default function MonitoringRootLayout() {
    const queryClient = useQueryClient();
    const { token } = useAuth();
    const { unreadCount } = useActivity();
    const [systemAgentDialogOpen, setSystemAgentDialogOpen] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const { entryById } = useMonitoringLinkLookup();

    const monitorsQuery = useResourceView(monitoredServicesView);
    const hostsQuery = useResourceView(monitoringHostsView);
    const sdkResourcesQuery = useApiQuery(queryKeys.monitoring.sdkResources, getSdkMonitoringResourcesAction);
    const monitors = monitorsQuery.data?.items ?? [];
    const hosts = hostsQuery.data?.items ?? [];
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
                        const entry = entryById.get(String(monitor.data.linkId || ""));
                        return (
                    <Tab
                        key={monitor.providerResourceId}
                        dst={`/apps/monitoring/${monitor.providerResourceId}`}
                        icon="fa6-solid:server"
                        title={entry?.title || String(monitor.data.name || monitor.data.url || monitor.providerResourceId)}
                        group="Monitors"
                        badge={typeof monitor.data.status === "string" ? monitor.data.status : undefined}
                    />
                        );
                    })()
                ))}

                <GroupLabel group="Hosts" title="Hosts" collapsible collapsed actions={[{ icon: "fa6-solid:plus", title: "Connect System Agent", action: () => setSystemAgentDialogOpen(true) }]} />
                {hosts.map((host) => (
                    <Tab key={host.providerResourceId} dst={`/apps/monitoring/hosts/${host.providerResourceId}`} icon="fa6-solid:hard-drive" title={String(host.data.name || host.data.hostname || host.providerResourceId)} group="Hosts" badge={typeof host.data.status === "string" ? host.data.status : undefined} />
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
                onCreated={() => {
                    void queryClient.invalidateQueries({ queryKey: ["api", token, "resources"] });
                    closeMonitorDialog();
                }}
                onSystemAgentRequested={() => setSystemAgentDialogOpen(true)}
            />

            <SystemAgentHostDialog
                open={systemAgentDialogOpen}
                onOpenChange={setSystemAgentDialogOpen}
                onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["api", token, "resources"] }); }}
            />

        </AppTemplate>
    );
}
