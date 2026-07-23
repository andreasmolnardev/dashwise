import { getSuperuserPB } from "../../lib/pb/pocketbase";

import { ensureBuiltinIntegrations } from "../../platform/integrations";

export async function runDefaultIntegrationsBootstrapJob() {
  const pb = await getSuperuserPB();
  const users = await pb.collection("users").getFullList({ sort: "-created" }).catch(() => []);

  for (const user of users) {
    if (!user?.id) continue;
    await ensureBuiltinIntegrations(user.id, pb);
  }
}
