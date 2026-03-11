import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import { hydratePageConfigWidgets } from "@dashwise/sdk/data/widgets";
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
};

function escapeFilter(value: string) {
    return value.replace(/"/g, '\\"');
}

// create new page (config)

// get page config
export async function getPageConfigJSON(
    userId: string,
    pageName: string,
    fillProperties = false
): Promise<Record<string, any> | null> {
    const pb = await getSuperuserPB();
    try {
        const record = await pb
            .collection("pageConfig")
            .getFirstListItem(
                `associatedUserId="${userId}" && pageName="${pageName}"`,
            );

        if (!record) return null;

        const config = (record?.config ?? {}) as Record<string, any>;
        if (fillProperties) {
            return await hydratePageConfigWidgets(userId, config);
        }
        return config;
    } catch (error: any) {
        if (error?.status === 404) return null;
        throw error.originalError ?? error;
    }
}

export async function getUserPages(
    userId: string,
): Promise<{ pageName: string }[]> {
    const pb = await getSuperuserPB();
    const records = await pb
        .collection("pageConfig")
        .getFullList(200, {
            filter: `associatedUserId="${escapeFilter(userId)}"`,
        });
    return records.map((record) => ({
        pageName: record.pageName,
    }));
}

async function getPageConfig(
    userId: string,
    pageName: string,
): Promise<PageConfigRecord | null> {
    const pb = await getSuperuserPB();
    try {
        return await pb
            .collection("pageConfig")
            .getFirstListItem(
                `associatedUserId="${escapeFilter(userId)}" && pageName="${
                    escapeFilter(pageName)
                }"`,
            );
    } catch (error: any) {
        if (error?.status === 404) return null;
        throw error;
    }
}

// update page config
export async function updatePageConfig(
    userId: string,
    pageName: string,
    config: Record<string, any>,
) {
    const pb = await getSuperuserPB();
    const existing = await getPageConfig(userId, pageName);
    if (existing) {
        return await pb.collection("pageConfig").update(existing.id, {
            config,
        });
    }
    return await pb.collection("pageConfig").create({
        associatedUserId: userId,
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
