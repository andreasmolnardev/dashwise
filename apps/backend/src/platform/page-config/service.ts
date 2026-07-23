import { getSuperuserPB } from "../../lib/pb/pocketbase";
import type { PageConfigResponse } from "@dashwise/types";

export type PageConfig = {
    appearance?: Record<string, unknown>;
    columns?: Record<string, unknown>;
    glanceables?: Array<Record<string, unknown>>;
    meta?: Record<string, unknown> & { onboard?: boolean };
    pages?: string[];
    template?: string;
    [key: string]: unknown;
};

type PageConfigRecord = Pick<
    PageConfigResponse<PageConfig>,
    "id" | "pageName" | "associatedUserId" | "config" | "created" | "updated"
>;

function escapeFilter(value: string) {
    return value.replace(/"/g, '\\"');
}

export async function getPageConfigJSON(
    userId: string,
    pageName: string,
): Promise<PageConfig | null> {
    const pb = await getSuperuserPB();
    try {
        const record = await pb
            .collection("pageConfig")
            .getFirstListItem(
                `associatedUserId="${userId}" && pageName="${pageName}"`,
            );

        if (!record) return null;

        const config = (record?.config ?? {}) as PageConfig;
        return config;
    } catch (error: unknown) {
        if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 404) return null;
        if (error && typeof error === "object" && "originalError" in error && (error as { originalError?: unknown }).originalError) {
            throw (error as { originalError: unknown }).originalError;
        }
        throw error;
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
    } catch (error: unknown) {
        if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 404) return null;
        throw error;
    }
}

export async function createPageFromDefaultConfig(
    userId: string,
    pageName: string,
    defaultHomeConfig: PageConfig,
) {
    const pb = await getSuperuserPB();

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

export async function updatePageConfig(
    userId: string,
    pageName: string,
    config: PageConfig,
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

export async function deletePageConfig(userId: string, pageName: string) {
    const pb = await getSuperuserPB();
    const existing = await getPageConfig(userId, pageName);
    if (existing) {
        await pb.collection("pageConfig").delete(existing.id);
    }
}

export { migrateLegacyPageConfig } from "../../lib/data/config";
