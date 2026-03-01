import Fastify from "fastify";
import axios from "axios";
import cron from "node-cron";
import { Buffer } from "buffer";

import { config } from "./config/env";
import { getSuperuserPB } from "./lib/pb";

import indexStatusMonitoringJobs from "./monitoring/indexer";
import { runStatusMonitoringJobs } from "./monitoring/runner";
import { runComparisonRunner } from "./updates/comparison-runner";
import { newsFeedBuilder } from "./news/feed-builder";
import { processQueuedNotifications } from "./notifications/forwarder";

const fastify = Fastify({ logger: true });

const jobsAuthHeader = {
  Authorization: `Basic ${Buffer.from(
    `${config.PB_ADMIN_EMAIL}:${config.PB_ADMIN_PASSWORD}`,
    "utf-8"
  ).toString("base64")}`,
};

console.log("dashwise job runner is active")
//connect to pocketbase
getSuperuserPB().then(pb => {
  console.log("Connected to Pocketbase")
}).catch((error) => {
  console.error(error)
});


// search items
async function triggerSearchItemIndexing() {
  try {
    const response = await axios.get(`${config.DASHWISE_URL}/api/v1/jobs/searchItems`, {
      headers: jobsAuthHeader,
    });
    console.log("Search items job triggered successfully:", response.status);
  } catch (error) {
    console.error("Error triggering search items indexing:", error);
  }
}

cron.schedule(config.SEARCHITEMS_SCHEDULE, () => triggerSearchItemIndexing());

fastify.get("/webhook/searchItemIndexer", async (request, reply) => {
  console.log("Webhook received");
  await triggerSearchItemIndexing();
  reply.send({ message: "Search item indexing triggered" });
});

// refresh icons
async function triggerPullIconsJob() {
  try {
    const response = await axios.get(`${config.DASHWISE_URL}/api/v1/jobs/pullIcons`, {
      headers: jobsAuthHeader,
    });
    console.log("Pull icons job triggered successfully:", response.status);
  } catch (error) {
    console.error("Error triggering pull icons job:", error);
  }
}

if (config.ENABLE_ICONS_REFRESH === true) {
  cron.schedule(config.PULL_ICONS_SCHEDULE, () => triggerPullIconsJob());
}

fastify.get("/webhook/pullIcons", async (request, reply) => {
  console.log("Webhook received");
  await triggerPullIconsJob();
  reply.send({ message: "Pull icons job triggered" });
});

//link monitoring: indexer
cron.schedule(config.MONITORING_INDEXER_SCHEDULE, () => indexStatusMonitoringJobs());

fastify.get("/webhook/statusMonitoringIndexer", async (request, reply) => {
  console.log("Webhook received");
  await indexStatusMonitoringJobs();
  reply.send({ message: "status monitoring indexer triggered" });
});

//link monitoring: runner
cron.schedule(config.MONITORING_RUNNER_SCHEDULE, () => runStatusMonitoringJobs());

fastify.get("/webhook/statusMonitoringRunner", async (request, reply) => {
  console.log("Webhook received");
  await runStatusMonitoringJobs();
  reply.send({ message: "status monitoring runner triggered" });
});

//update checks
runComparisonRunner();
cron.schedule(config.UPDATE_CHECK_SCHEDULE, () => runComparisonRunner());

newsFeedBuilder();
cron.schedule(config.FEED_BUILDING_SCHEDULE, () => newsFeedBuilder());


fastify.get("/webhook/newsFeedBuilder", async (request, reply) => {
  const { feedId } = request.query as { feedId?: string };
  console.log("Webhook received", feedId ? `for feed ${feedId}` : "for all feeds");
  const result = await newsFeedBuilder(feedId);
  reply.send({ message: "news feed builder triggered", result });
});

//notification forwarding
cron.schedule(config.NOTIFICATION_FORWARDER_SCHEDULE, () => processQueuedNotifications());

fastify.post("/api/forward-notifications", async (request, reply) => {
  console.log("Notification forwarding webhook received");
  await processQueuedNotifications();
  reply.send({ message: "notification forwarding triggered" });
});

// Start http server
fastify.listen({ port: 3001, host: "0.0.0.0" });
