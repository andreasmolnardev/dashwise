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
};

function escapeFilter(value: string) {
    return value.replace(/"/g, '\\"');
}

// create new page (config)

// get page config
export async function getPageConfigJSON(
    userId: string,
    pageName: string,
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

export async function createPageFromDefaultConfig(
    userId: string,
    pageName: string,
    defaultHomeConfig: Record<string, any>,
) {
    const pb = await getSuperuserPB();

    // check if page already exists for user
    const existing = await getPageConfig(userId, pageName);
    if (existing) {
        throw new Error(
            `Page with name "${pageName}" already exists for this user`,
        );
    }

    const user = await pb.collection("users").getOne(userId);

    if (!user) {
        throw new Error("User not found");
    }

    await pb.collection("pageConfig").create({
        associatedUserId: user.id,
        config: defaultHomeConfig,
        pageName: "home",
    });

    return { pageName, pageConfig: defaultHomeConfig };
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
