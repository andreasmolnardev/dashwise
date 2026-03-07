import { getSuperuserPB } from "../lib/pocketbase";

export async function getAllUserConfigs(batchSize = 1000) {
	const pb = await getSuperuserPB();
	return pb.collection("userConfig").getFullList(batchSize);
}

export async function getUserConfigById(configId: string) {
	const pb = await getSuperuserPB();
	return pb.collection("userConfig").getOne(configId);
}

export async function getUserConfigsByAssociatedUserId(userId: string, batchSize = 1000) {
	const pb = await getSuperuserPB();
	return pb.collection("userConfig").getFullList(batchSize, {
		filter: `associatedUserId = "${userId}"`,
	});
}

export async function updateUserConfigRecord(configId: string, payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("userConfig").update(configId, payload);
}

export async function getMonitoringJobsByUserId(userId: string, batchSize = 2000) {
	const pb = await getSuperuserPB();
	return pb.collection("monitoringJobs").getFullList(batchSize, {
		filter: `userId = "${userId}"`,
	});
}

export async function getMonitoringJobs(batchSize = 2000, filter?: string) {
	const pb = await getSuperuserPB();
	return pb.collection("monitoringJobs").getFullList(batchSize, filter ? { filter } : undefined);
}

export async function createMonitoringJob(payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("monitoringJobs").create(payload);
}

export async function updateMonitoringJob(jobId: string, payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("monitoringJobs").update(jobId, payload);
}

export async function createMonitoringJobStatusLog(payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("monitoringJobStatusLogs").create(payload);
}

export async function getAppInfoRecords(batchSize = 200) {
	const pb = await getSuperuserPB();
	return pb.collection("appInfo").getFullList(batchSize);
}

export async function updateAppInfoRecord(recordId: string, payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("appInfo").update(recordId, payload);
}

export async function createAppInfoRecord(payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("appInfo").create(payload);
}

export async function createJobLog(payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("jobLogs").create(payload, { requestKey: null });
}

export async function getAllNewsFeeds(batchSize = 2000) {
	const pb = await getSuperuserPB();
	return pb.collection("newsFeeds").getFullList(batchSize);
}

export async function getNewsFeedById(feedId: string) {
	const pb = await getSuperuserPB();
	return pb.collection("newsFeeds").getOne(feedId);
}

export async function getNewsFeedItemsCacheByUrl(url: string) {
	const pb = await getSuperuserPB();
	return pb.collection("newsFeedItemsCache").getList(1, 1, {
		filter: `url="${url.replace(/"/g, '\\"')}"`,
	});
}

export async function updateNewsFeedItemsCache(recordId: string, payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("newsFeedItemsCache").update(recordId, payload);
}

export async function createNewsFeedItemsCache(payload: Record<string, unknown>) {
	const pb = await getSuperuserPB();
	return pb.collection("newsFeedItemsCache").create(payload);
}

export async function getQueuedNotificationItems(batchSize = 100) {
	const pb = await getSuperuserPB();
	return pb.collection("notificationItems").getFullList({
		filter: `forwardStatus="queued"`,
		batch: batchSize,
	});
}

export async function getActiveNotificationForwardersByTopic(topicId: string) {
	const pb = await getSuperuserPB();
	return pb.collection("notificationForwarders").getFullList({
		filter: `topic="${topicId}" && isActive=true`,
	});
}

export async function markNotificationAsDone(notificationId: string) {
	const pb = await getSuperuserPB();
	return pb.collection("notificationItems").update(notificationId, {
		forwardStatus: "done",
	});
}
