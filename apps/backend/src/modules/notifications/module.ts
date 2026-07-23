import notificationsRoute from "./internal/notifications.route";
import { config } from "../../lib/config";
import { processQueuedNotifications } from "./internal/forwarder-job";
import type { DashwiseBackendModule } from "../../platform/modules/types";

export const notificationForwarderJob = {
  id: "notificationForwarder",
  schedule: config.NOTIFICATION_FORWARDER_SCHEDULE,
  run: () => processQueuedNotifications(),
};

export const notificationsModule = {
  id: "notifications",
  name: "Notifications",
  routes: [notificationsRoute],
  jobs: [notificationForwarderJob],
} satisfies DashwiseBackendModule;
