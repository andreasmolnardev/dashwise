"use client";

import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import AppTemplate, { Content, GroupLabel, Sidebar, Tab } from "@/components/apps/LayoutTemplate";
import useAuth from "@/context/useAuth";
import { getMonitorsAction } from "@/app/actions/monitoring";
import type { MonitorRecord } from "@/app/actions/monitoring";

export default function MonitoringRootLayout() {
    const { token, withAuth } = useAuth();
    const [monitors, setMonitors] = useState<MonitorRecord[]>([]);

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
                />

                {monitors.map((monitor) => (
                    <Tab
                        key={monitor.id}
                        dst={`/apps/monitoring/${monitor.id}`}
                        icon="fa6-solid:server"
                        title={monitor.endpoint || monitor.source || monitor.id}
                        group="Monitors"
                        badge={monitor.status ? monitor.status : undefined}
                    />
                ))}
            </Sidebar>

            <Content>
                <Outlet />
            </Content>
        </AppTemplate>
    );
}
