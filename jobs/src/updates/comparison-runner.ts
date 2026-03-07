import { config } from "../config/env";
import semver from "semver";
import {
  createAppInfoRecord,
  getAppInfoRecords,
  updateAppInfoRecord,
} from "@dashwise/sdk/data/superuser";

async function fetchLatestGithubTag(repo: string): Promise<string | null> {
  if (!repo) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (res.ok) return (await res.json())?.tag_name ?? null;
  } catch {}
  return null;
}

export async function runVersionComparisonRunner() {
  const details: any[] = [];
  const { DASHWISE_VERSION: localVersion, GITHUB_REPO: repo } = config;
  const instanceName = "dashwise";

  const latestTag = await fetchLatestGithubTag(repo);

  let cmp: number | null = null;
  let newUpdate: boolean | null = null;

  if (latestTag && localVersion) {
    const cleanLocal = semver.coerce(localVersion)?.version ?? null;
    const cleanLatest = semver.coerce(latestTag)?.version ?? null;

    if (cleanLocal && cleanLatest) {
      cmp = semver.compare(cleanLatest, cleanLocal);
      newUpdate = semver.gt(cleanLatest, cleanLocal);
    }
  }

  details.push({ latestTag, compareResult: cmp, newUpdate });

  let updatedRecord = false;

  try {
    const records = await getAppInfoRecords(200);
    const record = records.find(
      (r: any) => r.instanceName?.toLowerCase() === instanceName.toLowerCase()
    );

    // updateAvailable is set to latestTag string if newUpdate is true, otherwise 0
    const payload = {
      instanceName,
      version: localVersion,
      updateAvailable: newUpdate ? latestTag : 0,
    };

    if (record) {
      const recordVersion = record.version ? semver.coerce(record.version)?.version : null;

      // Detect if local version is newer than app info in pocketbase
      const localIsNewer =
        recordVersion && localVersion
          ? semver.gt(semver.coerce(localVersion)!, recordVersion)
          : false;

      const changed =
        localIsNewer ||
        record.version !== payload.version ||
        record.updateAvailable !== payload.updateAvailable;

      if (changed) {
        await updateAppInfoRecord(record.id, payload);
        updatedRecord = true;
        details.push({
          action: "updated",
          id: record.id,
          localIsNewer,
          payload,
        });
      }
    } else {
      const created = await createAppInfoRecord(payload);
      updatedRecord = true;
      details.push({ action: "created", id: created.id, payload });
    }
  } catch (err: any) {
    details.push({ error: err?.message });
  }
}