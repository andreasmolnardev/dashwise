import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

type UserConfig = {
  associatedUserId: string;
  config: {
    links?: {
      name: string;
      icon: string;
      linkGroup: string;
      url: string;
    }[];
  };
};

type UserSearchItem = {
  id?: string;
  associatedUserId: string;
  searchItems: string;
};

type SearchItem = {
  name: string;
  icon: string;
  secondaryInfo: string;
  type: "link" | "app";
  action: string;
  tags?: string[];
};

function mapSearchItemsToJSON(items: SearchItem[]) {
  return JSON.stringify(
    items
      .map((item) => ({
        name: item.name,
        icon: item.icon,
        secondaryInfo: item.secondaryInfo,
        type: item.type,
        action: item.action,
        tags: item.tags,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
}

export async function runSearchItemsIndexing() {
  const pb = await getSuperuserPB();
  const configs = await pb.collection("userConfig").getFullList<UserConfig>();

  for (const userConfig of configs) {
    const associatedUserId = userConfig.associatedUserId;
    if (!associatedUserId) continue;

    const links = userConfig.config?.links ?? [];
    const searchItems: SearchItem[] = links.map((link) => ({
      name: link.name,
      icon: link.icon,
      secondaryInfo: link.linkGroup,
      type: "link",
      action: `url:${link.url}`,
      tags: [link.name, link.linkGroup].filter((tag): tag is string => !!tag),
    }));

    const desiredJson = mapSearchItemsToJSON(searchItems);

    const existing = await pb
      .collection("userSearchItems")
      .getFirstListItem<UserSearchItem>(`associatedUserId=\"${associatedUserId}\"`)
      .catch(() => null);

    if (existing) {
      if (existing.searchItems !== desiredJson) {
        await pb.collection("userSearchItems").update(existing.id!, {
          searchItems: desiredJson,
        });
      }
    } else {
      await pb.collection("userSearchItems").create({
        associatedUserId,
        searchItems: desiredJson,
      });
    }
  }
}
