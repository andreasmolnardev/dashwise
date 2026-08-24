import { getSuperuserPB } from "../pb/pocketbase";

async function safeNull(fn: (pb: any) => Promise<any>): Promise<any> {
	try {
		const pb = await getSuperuserPB();
		return await fn(pb);
	} catch {
		return null;
	}
}

export async function getAllUserConfigs(batchSize = 1000) {
	return safeNull((pb) => pb.collection("userConfig").getFullList(batchSize));
}

export async function getUserConfigById(configId: string) {
	return safeNull((pb) => pb.collection("userConfig").getOne(configId));
}

export async function getUserConfigsByAssociatedUserId(
	userId: string,
	batchSize = 1000,
) {
	return safeNull((pb) => pb.collection("userConfig").getFullList(batchSize, {
		filter: `associatedUserId = "${userId}"`,
	}));
}

export async function updateUserConfigRecord(
	configId: string,
	payload: Record<string, unknown>,
) {
	return safeNull((pb) => pb.collection("userConfig").update(configId, payload));
}

export async function getMonitorsByUserId(
	userId: string,
	batchSize = 2000,
) {
	return safeNull((pb) => pb.collection("monitors").getFullList(batchSize, {
		filter: `userId = "${userId}"`,
	}));
}

export async function getMonitors(batchSize = 2000, filter?: string) {
	return safeNull((pb) => pb.collection("monitors").getFullList(
		batchSize,
		filter ? { filter } : undefined,
	));
}

export async function getMonitorById(monitorId: string) {
	return safeNull((pb) => pb.collection("monitors").getOne(monitorId));
}

export async function createMonitor(payload: Record<string, unknown>) {
	return safeNull((pb) => pb.collection("monitors").create(payload));
}

export async function updateMonitor(
	monitorId: string,
	payload: Record<string, unknown>,
) {
	return safeNull((pb) => pb.collection("monitors").update(monitorId, payload));
}

export async function getMonitoringJobsByUserId(
	userId: string,
	batchSize = 2000,
) {
	return getMonitorsByUserId(userId, batchSize);
}

export async function getMonitoringJobs(batchSize = 2000, filter?: string) {
	return getMonitors(batchSize, filter);
}

export async function createMonitoringJob(payload: Record<string, unknown>) {
	return createMonitor(payload);
}

export async function updateMonitoringJob(
	jobId: string,
	payload: Record<string, unknown>,
) {
	return updateMonitor(jobId, payload);
}

export async function deleteMonitoringJob(jobId: string) {
	return safeNull((pb) => pb.collection("monitors").delete(jobId));
}

export async function getAppInfoRecords(batchSize = 200) {
	return safeNull((pb) => pb.collection("appInfo").getFullList(batchSize));
}

export async function updateAppInfoRecord(
	recordId: string,
	payload: Record<string, unknown>,
) {
	return safeNull((pb) => pb.collection("appInfo").update(recordId, payload));
}

export async function createAppInfoRecord(payload: Record<string, unknown>) {
	return safeNull((pb) => pb.collection("appInfo").create(payload));
}

export async function createJobLog(payload: Record<string, unknown>) {
	return safeNull((pb) => pb.collection("jobLogs").create(payload, { requestKey: null }));
}

export async function getAllNewsFeeds(batchSize = 2000, options?: Record<string, unknown>) {
	return safeNull((pb) => pb.collection("newsFeeds").getFullList(batchSize, options));
}

export async function getNewsFeedsByUserId(userId: string, batchSize = 2000, options?: Record<string, unknown>) {
	return safeNull((pb) => pb.collection("newsFeeds").getFullList(batchSize, {
		...options,
		filter: `userId="${userId.replace(/"/g, '\\"')}"`,
	}));
}

export async function getNewsFeedByTitle(userId: string, title: string) {
	return safeNull((pb) => pb.collection("newsFeeds").getFirstListItem(
		`userId="${userId.replace(/"/g, '\\"')}" && title="${title.replace(/"/g, '\\"')}"`,
	));
}

export async function getNewsFeedBySystemKey(userId: string, systemKey: string) {
	return safeNull((pb) => pb.collection("newsFeeds").getFirstListItem(
		`userId="${userId.replace(/"/g, '\\"')}" && systemKey="${systemKey.replace(/"/g, '\\"')}"`,
	));
}

export async function createNewsFeedRecord(payload: Record<string, unknown>) {
	return safeNull((pb) => pb.collection("newsFeeds").create(payload));
}

export async function updateNewsFeedRecord(
	feedId: string,
	payload: Record<string, unknown>,
) {
	return safeNull((pb) => pb.collection("newsFeeds").update(feedId, payload));
}

export async function getAllNewsSubscriptions(batchSize = 2000, options?: Record<string, unknown>) {
	return safeNull((pb) => pb.collection("newsSubscriptions").getFullList(batchSize, options));
}

export async function getNewsFeedById(feedId: string) {
	return safeNull((pb) => pb.collection("newsFeeds").getOne(feedId));
}

export async function getNewsSubscriptionById(subscriptionId: string) {
	return safeNull((pb) => pb.collection("newsSubscriptions").getOne(subscriptionId));
}

export async function getNewsSubscriptionByUrl(url: string) {
	return safeNull((pb) => pb.collection("newsSubscriptions").getFirstListItem(
		`url="${url.replace(/"/g, '\\"')}"`,
	));
}

export async function updateNewsSubscription(
	subscriptionId: string,
	payload: Record<string, unknown>,
) {
	return safeNull((pb) => pb.collection("newsSubscriptions").update(subscriptionId, payload));
}

export async function createNewsSubscription(payload: Record<string, unknown>) {
	return safeNull((pb) => pb.collection("newsSubscriptions").create(payload));
}

export async function deleteNewsSubscription(subscriptionId: string) {
	return safeNull((pb) => pb.collection("newsSubscriptions").delete(subscriptionId));
}

export async function getQueuedNotificationItems(batchSize = 100) {
	return safeNull((pb) => pb.collection("notificationItems").getFullList({
		filter: `forwardStatus="queued"`,
		batch: batchSize,
	}));
}

export async function getActiveNotificationForwardersByTopic(topicId: string) {
	return safeNull((pb) => pb.collection("notificationForwarders").getFullList({
		filter: `topic="${topicId}" && isActive=true`,
	}));
}

export async function markNotificationAsDone(notificationId: string) {
	return safeNull((pb) => pb.collection("notificationItems").update(notificationId, {
		forwardStatus: "done",
	}));
}
