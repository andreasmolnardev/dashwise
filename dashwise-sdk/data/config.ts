import { ClientResponseError } from "pocketbase";
import { ensureUserConfig } from "@/lib/api/config/retrieve";
import { getSuperuserPB } from "@/lib/pb";
import { ApiActionError } from "@dashwise/sdk/data/auth";

function setNested(obj: Record<string, any>, path: string, value: any) {
  const keys = path.split(".");
  let current = obj;

  keys.forEach((key, idx) => {
    if (idx === keys.length - 1) {
      if (value === undefined) {
        delete current[key];
      } else {
        current[key] = value;
      }
      return;
    }

    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  });
}

export async function getUserConfig(userId: string) {
  const pb = await getSuperuserPB();

  let configRecord;
  try {
    configRecord = await ensureUserConfig(pb, userId);
  } catch (err: any) {
    if (err?.status === 403 || err?.message === "Associated user not found") {
      throw new ApiActionError("Invalid user", 403, { error: "Invalid user" });
    }
    throw err;
  }

  const rawIntegrations = configRecord?.config?.integrations ?? {};
  const strippedIntegrations = Object.fromEntries(
    Object.entries(rawIntegrations).map(([key, value]) => [
      key,
      !!value &&
        !Array.isArray(value) &&
        typeof value === "object" &&
        Object.keys(value).length > 0,
    ])
  );

  configRecord.config.integrations = strippedIntegrations;
  return configRecord.config;
}

async function getUserConfigRecord(pb: any, userId: string) {
  return pb.collection("userConfig").getFirstListItem(`associatedUserId="${userId}"`);
}

export async function appendConfigArrayItem(userId: string, path: string, newItem: any) {
  const pb = await getSuperuserPB();
  const record = await getUserConfigRecord(pb, userId);
  const config = record.config as Record<string, any>;

  if (!Array.isArray(config[path])) {
    throw new ApiActionError(`Config key "${path}" is not an array`, 400, {
      error: `Config key "${path}" is not an array`,
    });
  }

  config[path].push(newItem);
  await pb.collection("userConfig").update(record.id, { config });

  return {
    success: true,
    updatedPath: path,
    newItem,
  };
}

export async function patchConfigPath(userId: string, path: string, updatedItem: any) {
  const pb = await getSuperuserPB();
  const record = await getUserConfigRecord(pb, userId);
  const config = record.config as Record<string, any>;

  setNested(config, path, updatedItem);
  await pb.collection("userConfig").update(record.id, { config });

  return {
    success: true,
    updatedPath: path,
    newItem: updatedItem,
  };
}

export async function replaceUserConfig(userId: string, nextConfig: Record<string, any>) {
  const pb = await getSuperuserPB();

  let record: any | null = null;
  try {
    record = await getUserConfigRecord(pb, userId);
  } catch {
    record = null;
  }

  if (record) {
    await pb.collection("userConfig").update(record.id, { config: nextConfig });
  } else {
    await pb.collection("userConfig").create({
      associatedUserId: userId,
      config: nextConfig,
    });
  }

  return { success: true };
}

export async function deleteUnusedLinkgroups(userId: string) {
  const pb = await getSuperuserPB();
  const record: any = await getUserConfigRecord(pb, userId);

  const config = (record.config ?? {}) as {
    linkGroups?: string[];
    links?: Array<{ linkGroup: string; [key: string]: any }>;
  };

  config.linkGroups = Array.isArray(config.linkGroups) ? config.linkGroups : [];
  config.links = Array.isArray(config.links) ? config.links : [];

  const originalLinkGroups = [...config.linkGroups];
  const originalLinks = [...config.links];

  const usedGroups = new Set(
    config.links
      .map((link) => (typeof link.linkGroup === "string" ? link.linkGroup.trim() : ""))
      .filter(Boolean)
  );

  const prunedLinkGroups = config.linkGroups
    .map((group) => (typeof group === "string" ? group.trim() : String(group)))
    .filter((group) => usedGroups.has(group));

  const uniquePrunedLinkGroups = Array.from(new Set(prunedLinkGroups));

  const prunedLinks = config.links.filter((link) =>
    uniquePrunedLinkGroups.includes(
      typeof link.linkGroup === "string" ? link.linkGroup.trim() : String(link.linkGroup)
    )
  );

  const removedLinkGroups = originalLinkGroups.filter(
    (group) =>
      !uniquePrunedLinkGroups.includes(
        typeof group === "string" ? group.trim() : String(group)
      )
  );

  const removedLinks = originalLinks.filter(
    (link) =>
      !prunedLinks.some(
        (prunedLink) =>
          prunedLink.url === link.url &&
          prunedLink.name === link.name &&
          (prunedLink.linkGroup === link.linkGroup ||
            String(prunedLink.linkGroup).trim() === String(link.linkGroup).trim())
      )
  );

  config.linkGroups = uniquePrunedLinkGroups;
  config.links = prunedLinks;
  await pb.collection("userConfig").update(record.id, { config });

  return {
    success: true,
    removedLinkGroups,
    removedLinks,
    updatedCounts: {
      linkGroups: config.linkGroups.length,
      links: config.links.length,
    },
    config: {
      linkGroups: config.linkGroups,
      links: config.links.length,
    },
  };
}

export async function moveConfigArrayItems(userId: string, path: string, src: number, dst: number) {
  const pb = await getSuperuserPB();
  const record = await getUserConfigRecord(pb, userId);
  const config = record.config as Record<string, any>;

  if (!Array.isArray(config[path])) {
    throw new ApiActionError(`Config key "${path}" is not an array`, 400, {
      error: `Config key "${path}" is not an array`,
    });
  }

  const arr = config[path];
  if (src < 0 || src >= arr.length || dst < 0 || dst >= arr.length) {
    throw new ApiActionError("src or dst index out of bounds", 400, {
      error: "src or dst index out of bounds",
    });
  }

  const [movedItem] = arr.splice(src, 1);
  arr.splice(dst, 0, movedItem);

  await pb.collection("userConfig").update(record.id, { config });

  return {
    success: true,
    updatedPath: path,
    movedItem,
    newArray: arr,
  };
}
