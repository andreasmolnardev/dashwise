import { config } from "../../lib/config";
import { semver } from "bun";
import {
  createAppInfoRecord,
  getAppInfoRecords,
  updateAppInfoRecord,
} from "@dashwise/sdk/data/superuser";

function normalizeVersion(version: string | null | undefined) {
  return String(version ?? "").trim().replace(/^v/i, "");
}

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
    const cleanLocal = normalizeVersion(localVersion);
    const cleanLatest = normalizeVersion(latestTag);

    if (cleanLocal && cleanLatest) {
      cmp = semver.order(cleanLatest, cleanLocal);
      newUpdate = cmp > 0;
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
      const recordVersion = record.version ? normalizeVersion(record.version) : null;

      // Detect if local version is newer than app info in pocketbase
      const localIsNewer =
        recordVersion && localVersion
          ? semver.order(normalizeVersion(localVersion), recordVersion) > 0
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