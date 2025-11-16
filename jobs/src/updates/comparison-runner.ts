import { config } from "../config/env";
import { getSuperuserPB } from "../lib/pb";
import semver from "semver";

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

export async function runComparisonRunner() {
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

  const pb = await getSuperuserPB();
  let updatedRecord = false;

  try {
    const records = await pb.collection("appInfo").getFullList(200);
    const record = records.find(
      (r) => r.instanceName?.toLowerCase() === instanceName.toLowerCase()
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
        await pb.collection("appInfo").update(record.id, payload);
        updatedRecord = true;
        details.push({
          action: "updated",
          id: record.id,
          localIsNewer,
          payload,
        });
      }
    } else {
      const created = await pb.collection("appInfo").create(payload);
      updatedRecord = true;
      details.push({ action: "created", id: created.id, payload });
    }
  } catch (err: any) {
    details.push({ error: err?.message });
  }
}