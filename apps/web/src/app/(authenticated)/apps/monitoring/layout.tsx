"use client";

import { Outlet, useSearchParams } from "react-router-dom";
import { useState } from "react";
import AppTemplate, { BottomTab, Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";
import { getMonitorsAction } from '@/lib/apiClient';
import { getMonitoringHostsAction, getMonitoringSshHostsAction } from '@/lib/apiClient';
import type { MonitorRecord, MonitoringHostRecord, MonitoringSshHostRecord } from '@/lib/apiClient';
import { useActivity } from "@/context/ActivityContext";
import config from "@/lib/config";
import AddMonitoringResourceDialog from "@/components/monitoring/AddMonitoringResourceDialog";
import SshHostDialog from "@/components/monitoring/SshHostDialog";
import SystemAgentHostDialog from "@/components/monitoring/SystemAgentHostDialog";
import { useMonitoringLinkLookup } from "@/components/monitoring/useMonitoringLinkLookup";
import SshSessionsProvider from "@/components/monitoring/ssh/SshSessionsProvider";
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
    const { entryById } = useMonitoringLinkLookup();

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
                        title={entry?.title || monitor.endpoint || monitor.sourcelinkId || monitor.source || monitor.id}
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

                <GroupLabel
                    group="SSH"
                    title="SSH"
                    collapsible
                    collapsed
                    actions={[{ icon: "fa6-solid:plus", title: "Add SSH Host", action: () => openSshHostDialog() }]}
                />

                {sshHosts.map((host) => (
                    <Tab
                        key={host.id}
                        dst={`/apps/monitoring/ssh/${host.id}`}
                        icon="fa6-solid:terminal"
                        title={host.name || `${host.hostname}:${host.port}`}
                        group="SSH"
                        badge={host.status || undefined}
                        dropdownActions={[{ label: "Edit host", icon: "fa6-solid:pencil", action: () => openSshHostDialog(host) }]}
                    />
                ))}

                
            </Sidebar>

            <Content>
                <SshSessionsProvider hosts={sshHosts}>
                    <Outlet />
                </SshSessionsProvider>
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
        </AppTemplate>
    );
}
