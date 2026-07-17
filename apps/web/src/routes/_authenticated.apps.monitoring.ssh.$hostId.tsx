import { createFileRoute } from "@tanstack/react-router";
import MonitoringSshPage from "./_authenticated.apps.monitoring.ssh";

export const Route = createFileRoute("/_authenticated/apps/monitoring/ssh/$hostId")({ component: MonitoringSshPage });
