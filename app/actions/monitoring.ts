"use server";

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getMonitoringStatus, runMonitoringStatus } from "@dashwise/sdk/data/monitoring";

export async function getMonitoringStatusAction(auth: ActionAuth, jobId?: string | null) {
  const { userId } = await requireUserAuth(auth);
  return getMonitoringStatus(userId, jobId);
}

export async function updateMonitoringStatusAction(auth: ActionAuth, body: any) {
  const { userId } = await requireUserAuth(auth);
  return runMonitoringStatus(userId, body);
}
