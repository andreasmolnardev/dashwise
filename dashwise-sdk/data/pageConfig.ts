import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
/*
PAGE CONFIG
format:
{
    "template": "main", #main: 3 cols, expand middle one,
    "columns": {
        "left": [],
        "middle": {
        "main-clock": {},

        "right": []
    }
}
*/

type PageConfigRecord = {
    id: string;
    pageName: string;
    associatedUserId: string;
    config: Record<string, any>;
    created: string;
    updated: string;
}

function escapeFilter(value: string) {
  return value.replace(/"/g, '\\"');
}

// create new page (config)

// get page config
export async function getPageConfigJSON(userId: string, pageName: string): Promise<PageConfigRecord | null>  {
      const pb = await getSuperuserPB();
      try {
        return await pb
          .collection("pageConfig")
          .getFirstListItem(`userId="${escapeFilter(userId)} && pageName="${escapeFilter(pageName)}"`);
      } catch (error: any) {
        if (error?.status === 404) return null;
        throw error;
      }
}

async function getPageConfig(userId: string, pageName: string): Promise<PageConfigRecord | null>  {
      const pb = await getSuperuserPB();
      try {
        return await pb
          .collection("pageConfig")
          .getFirstListItem(`userId="${escapeFilter(userId)} && pageName="${escapeFilter(pageName)}"`);
      } catch (error: any) {
        if (error?.status === 404) return null;
        throw error;
      }
}

// update page config
export async function updatePageConfig(userId: string, pageName: string, config: Record<string, any>) {
    const pb = await getSuperuserPB();
    const existing = await getPageConfig(userId, pageName);
    if (existing) {
        return await pb.collection("pageConfig").update(existing.id, {
            config,
        });
    }
    return await pb.collection("pageConfig").create({
        userId,
        pageName,
        config,
    });
}               
// delete page config
export async function deletePageConfig(userId: string, pageName: string) {
    const pb = await getSuperuserPB();
    const existing = await getPageConfig(userId, pageName);
    if (existing) {
        await pb.collection("pageConfig").delete(existing.id);
    }
}
