"use client";

import { Outlet, useSearchParams } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import AppTemplate, { BottomTab, Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";
import useAuth from "@/context/useAuth";
import { getMonitorsAction } from '@/lib/apiClient';
import { getMonitoringSshHostsAction } from '@/lib/apiClient';
import { getNotificationsAction } from '@/lib/apiClient';
import type { MonitorRecord, MonitoringSshHostRecord } from '@/lib/apiClient';
import { NOTIFICATIONS_UPDATED_EVENT } from "@/lib/events";
import config from "@/lib/config";
import AddMonitoringResourceDialog from "@/components/monitoring/AddMonitoringResourceDialog";
import SshHostDialog from "@/components/monitoring/SshHostDialog";
import { useMonitoringLinkLookup } from "@/components/monitoring/useMonitoringLinkLookup";
import SshSessionsProvider from "@/components/monitoring/ssh/SshSessionsProvider";

export default function MonitoringRootLayout() {
    const { token, withAuth } = useAuth();
    const [monitors, setMonitors] = useState<MonitorRecord[]>([]);
    const [sshHosts, setSshHosts] = useState<MonitoringSshHostRecord[]>([]);
    const [sshHostDialogOpen, setSshHostDialogOpen] = useState(false);
    const [editingSshHost, setEditingSshHost] = useState<MonitoringSshHostRecord | null>(null);
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const [searchParams, setSearchParams] = useSearchParams();
    const { entryById } = useMonitoringLinkLookup();

    const fetchUnreadCount = useCallback(async () => {
        if (!token) return;
        try {
            const data = await withAuth((auth) =>
                getNotificationsAction(auth, false, true)
            );
            setUnreadCount(data?.unread || 0);
        } catch (err) {
            console.error(err);
        }
    }, [token, withAuth]);

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

    useEffect(() => {
        if (!token) {
            setMonitors([]);
            return;
        }

        let mounted = true;

        const loadMonitors = async () => {
            try {
                const [monitorList, sshHostList] = await Promise.all([
                    withAuth((auth) => getMonitorsAction(auth)),
                    withAuth((auth) => getMonitoringSshHostsAction(auth)),
                ]);
                if (!mounted) return;
                setMonitors(Array.isArray(monitorList) ? monitorList : []);
                setSshHosts(Array.isArray(sshHostList) ? sshHostList : []);
            } catch (err) {
                console.error("Failed to load monitors:", err);
                if (mounted) {
                    setMonitors([]);
                    setSshHosts([]);
                }
            }
        };

        loadMonitors();

        return () => {
            mounted = false;
        };
    }, [token, withAuth]);

    useEffect(() => {
        fetchUnreadCount();
    }, [fetchUnreadCount]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, fetchUnreadCount);
        return () =>
            window.removeEventListener(
                NOTIFICATIONS_UPDATED_EVENT,
                fetchUnreadCount,
            );
    }, [fetchUnreadCount]);

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
                    setMonitors((current) => [monitor, ...current.filter((existing) => existing.id !== monitor.id)]);
                    closeMonitorDialog();
                }}
            />

            <SshHostDialog
                open={sshHostDialogOpen}
                host={editingSshHost}
                onOpenChange={(open) => {
                    setSshHostDialogOpen(open);
                    if (!open) setEditingSshHost(null);
                }}
                onSaved={(host) => {
                    setSshHosts((current) => [host, ...current.filter((existing) => existing.id !== host.id)]);
                }}
            />
        </AppTemplate>
    );
}
