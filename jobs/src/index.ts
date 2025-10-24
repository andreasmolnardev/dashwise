import Fastify from "fastify";
import axios from "axios";
import cron from "node-cron";
import { config } from "./config/env";

const fastify = Fastify({ logger: true });

console.log("dashwise job runner is active")

// search items
async function triggerSearchItemIndexing() {
  try {
    const response = await axios.get(`${config.DASHWISE_URL}/api/v1/jobs/searchItems`);
    console.log("Search items job triggered successfully:", response.status);
  } catch (error) {
    console.error("Error triggering search items job:", error);
  }
}

cron.schedule(config.SEARCHITEMS_SCHEDULE, () => triggerSearchItemIndexing());

fastify.get("/webhook/searchItemIndexer", async (request, reply) => {
  console.log("Webhook received");
  await triggerSearchItemIndexing();
  reply.send({ message: "Search item indexing triggered" });
});

// Start server
fastify.listen({ port: 3001, host: "0.0.0.0" });
