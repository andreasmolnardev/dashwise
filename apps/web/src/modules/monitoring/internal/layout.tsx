"use client";

import { Outlet, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { ModuleNavigation, type ModuleNavigationContribution } from "@/platform/navigation/ModuleNavigation";
import { getMonitorsAction } from '@/lib/apiClient';
import { getMonitoringHostsAction, getMonitoringSshHostsAction } from '@/lib/apiClient';
import type { MonitorRecord, MonitoringHostRecord, MonitoringSshHostRecord } from '@/lib/apiClient';
import { useActivity } from "@/context/ActivityContext";
import config from "@/lib/config";
import AddMonitoringResourceDialog from "./AddMonitoringResourceDialog";
import SshHostDialog from "./SshHostDialog";
import SystemAgentHostDialog from "./SystemAgentHostDialog";
import { useLinksLookup } from "@/modules/links";
import SshSessionsProvider from "./ssh/SshSessionsProvider";
import { useApiQuery } from "@/hooks/useApiQuery";
import { queryKeys } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import useAuth from "@/context/useAuth";

export default function MonitoringRootLayout() {
    const queryClient = useQueryClient();
    const { token } = useAuth();
    const { unreadCount } = useActivity();
    const [sshHostDialogOpen, setSshHostDialogOpen] = useState(false);
    const [systemAgentDialogOpen, setSystemAgentDialogOpen] = useState(false);
    const [editingSshHost, setEditingSshHost] = useState<MonitoringSshHostRecord | null>(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const { entryById } = useLinksLookup();

    const monitorsQuery = useApiQuery(queryKeys.monitoring.monitors, getMonitorsAction);
    const hostsQuery = useApiQuery(queryKeys.monitoring.hosts, getMonitoringHostsAction);
    const sshHostsQuery = useApiQuery(queryKeys.monitoring.sshHosts, getMonitoringSshHostsAction);
    const monitors = (monitorsQuery.data ?? []) as MonitorRecord[];
    const hosts = (hostsQuery.data ?? []) as MonitoringHostRecord[];
    const sshHosts = (sshHostsQuery.data ?? []) as MonitoringSshHostRecord[];

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

    const openSshHostDialog = (host?: MonitoringSshHostRecord) => {
        setEditingSshHost(host ?? null);
        setSshHostDialogOpen(true);
    };

    return (
        <ModuleNavigation title="Monitoring" contributions={[
            { kind: "item", id: "overview", path: "/apps/monitoring", icon: "fa6-solid:gauge-high", label: "Overview", isRoot: true },
            { kind: "bottom-tab", id: "notifications", path: "/apps/monitoring/notifications", icon: "fa6-solid:bell", label: "Notifications", isRoot: true, badge: unreadCount > 0 ? unreadCount : undefined },
            { kind: "group", id: "monitors", group: "Monitors", collapsible: true, actions: [{ icon: "fa6-solid:plus", title: "Add Monitor", action: openMonitorDialog }] },
            ...monitors.map((monitor): ModuleNavigationContribution => ({ kind: "item", id: `monitor-${monitor.id}`, path: `/apps/monitoring/${monitor.id}`, icon: "fa6-solid:server", label: entryById.get(String(monitor.sourcelinkId || monitor.linkId || ""))?.title || monitor.endpoint || monitor.sourcelinkId || monitor.source || monitor.id, group: "Monitors", badge: monitor.status || undefined })),
            { kind: "group", id: "hosts", group: "Hosts", collapsible: true, actions: [{ icon: "fa6-solid:plus", title: "Connect System Agent", action: () => setSystemAgentDialogOpen(true) }] },
            ...hosts.map((host): ModuleNavigationContribution => ({ kind: "item", id: `host-${host.id}`, path: `/apps/monitoring/hosts/${host.id}`, icon: "fa6-solid:hard-drive", label: host.name || host.hostname || host.id, group: "Hosts", badge: host.status || undefined })),
            { kind: "group", id: "ssh", group: "SSH", collapsible: true, actions: [{ icon: "fa6-solid:plus", title: "Add SSH Host", action: () => openSshHostDialog() }] },
            ...sshHosts.map((host): ModuleNavigationContribution => ({ kind: "item", id: `ssh-${host.id}`, path: `/apps/monitoring/ssh/${host.id}`, icon: "fa6-solid:terminal", label: host.name || `${host.hostname}:${host.port}`, group: "SSH", badge: host.status || undefined, dropdownActions: [{ label: "Edit host", icon: "fa6-solid:pencil", action: () => openSshHostDialog(host) }] })),
        ]} overlays={<>
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

            <SshHostDialog
                open={sshHostDialogOpen}
                host={editingSshHost}
                onOpenChange={(open) => {
                    setSshHostDialogOpen(open);
                    if (!open) setEditingSshHost(null);
                }}
                onSaved={(host) => {
                    queryClient.setQueryData<MonitoringSshHostRecord[]>(["api", token, ...queryKeys.monitoring.sshHosts], (current = []) => [host, ...current.filter((existing) => existing.id !== host.id)]);
                }}
            />
        </>}>
            <SshSessionsProvider hosts={sshHosts}>
                <Outlet />
            </SshSessionsProvider>
        </ModuleNavigation>
    );
}
