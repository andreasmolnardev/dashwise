import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

import { semver } from "bun";
import { YAML } from "bun";

function normalizeVersion(version: string | null | undefined) {
  return String(version ?? "").trim().replace(/^v/i, "");
}

export async function runIntegrationUpdaterJob() {
  const pb = await getSuperuserPB();
  const integrations = await pb.collection("integrations").getFullList().catch(() => []);

  for (const record of integrations) {
    if (!record.source || !record.source.startsWith("http")) {
      continue;
    }

    try {
      const response = await fetch(record.source);
      if (!response.ok) continue;

      const text = await response.text();
      const remoteConfig = YAML.parse(text);

      const remoteVersion = remoteConfig?.details?.version;
      if (!remoteVersion) continue;

      let localConfig = record.config;
      if (typeof localConfig === "string") {
        try {
          localConfig = JSON.parse(localConfig);
        } catch {
          try {
            localConfig = YAML.parse(localConfig);
          } catch {
            localConfig = {};
          }
        }
      }

      const localVersion = localConfig?.details?.version;
      
      let newUpdateAvailable = false;

      if (localVersion) {
        const cleanLocal = normalizeVersion(localVersion);
        const cleanRemote = normalizeVersion(remoteVersion);

        if (cleanLocal && cleanRemote && semver.order(cleanRemote, cleanLocal) > 0) {
          newUpdateAvailable = true;
        }
      } else if (remoteVersion) {
        newUpdateAvailable = true;
      }

      if (newUpdateAvailable) {
        let localData = record.localData;
        if (typeof localData === "string") {
          try {
            localData = JSON.parse(localData);
          } catch {
            localData = {};
          }
        }
        if (!localData || typeof localData !== "object") {
          localData = {};
        }

        const changed = localData.updateAvailable !== true || localData.remoteVersion !== remoteVersion || localData.remoteConfig !== text;

        if (changed) {
          localData.updateAvailable = true;
          localData.remoteVersion = remoteVersion;
          localData.remoteConfig = text; // store the raw yaml string to diff against
          
          await pb.collection("integrations").update(record.id, {
            localData
          });
        }
      } else if (record.localData) {
        let localData = record.localData;
        if (typeof localData === "string") {
          try {
            localData = JSON.parse(localData);
          } catch {
            localData = {};
          }
        }

        if (!localData || typeof localData !== "object") {
          localData = {};
        }

        if (localData.updateAvailable) {
          localData.updateAvailable = false;
          delete localData.remoteVersion;
          delete localData.remoteConfig;
          await pb.collection("integrations").update(record.id, {
            localData,
          });
        }
      }
    } catch (err) {
      console.error(`Failed to check updates for integration ${record.id}`, err);
    }
  }
}
