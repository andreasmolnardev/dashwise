import Fastify from "fastify";
import axios from "axios";
import cron from "node-cron";

import { config } from "./config/env";
import { getSuperuserPB } from "./lib/pb";

import indexStatusMonitoringJobs from "./monitoring/indexer";
import { runStatusMonitoringJobs } from "./monitoring/runner";
import { runComparisonRunner } from "./updates/comparison-runner";
import { newsFeedBuilder } from "./news/feed-builder";
import { processQueuedNotifications } from "./notifications/forwarder";

const fastify = Fastify({ logger: true });

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
    const response = await axios.get(`${config.DASHWISE_URL}/api/v1/jobs/searchItems`);
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
  reply.send({ message: "status monitoring indexer triggered" });
});

//update checks
runComparisonRunner();
cron.schedule(config.UPDATE_CHECK_SCHEDULE, () => runComparisonRunner());

newsFeedBuilder();
cron.schedule(config.FEED_BUILDING_SCHEDULE, () => newsFeedBuilder());


fastify.get("/webhook/newsFeedBuilder", async (request, reply) => {
  console.log("Webhook received");
  await newsFeedBuilder();
  reply.send({ message: "news feed builder triggered" });
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
