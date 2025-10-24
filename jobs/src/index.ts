import { config } from "./config/env";

//test pocketbase connection
console.log(config.PB_URL, config.PB_ADMIN_EMAIL, config.PB_ADMIN_PASSWORD)

//initiate search item indexing + execute on webhook