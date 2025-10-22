import { KarakeepSearchItems } from "./clients/karakeep/client.ts";
import config from "./config.ts";
import pb, { getSuperuserPB } from "./pb.ts";

type UserConfig = {
    id: string;
    associatedUserId: string;
    config: {
        links?: {
            name: string;
            icon: string;
            linkGroup: string;
            url: string;
        }[];
        integrations?: {
            Karakeep?: {
                api_token: string;
                server_location: string;
            };
            News?: Record<string, never>;
            Notifications?: Record<string, never>;
        };
    };
};

type UserSearchItem = {
    id?: string;
    associatedUserId: string;
    searchItems: string; // JSON string of all search items
};

export type SearchItem = {
    id?: string;
    name: string;
    icon: string;
    secondaryInfo: string;
    type: "link" | "karakeepBookmark";
    action: string;
};

function mapSearchItemsToJSON(items: SearchItem[]) {
    return JSON.stringify(
        items
            .map(i => ({
                name: i.name,
                icon: i.icon,
                secondaryInfo: i.secondaryInfo,
                type: i.type,
                action: i.action,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
    );
}

export default async function runBackgroundJobs() {
    try {
        const pb = await getSuperuserPB();
        const configs = await pb.collection("userConfig").getFullList<UserConfig>()

        for (const userConfig of configs) {
            const associatedUserId = userConfig.associatedUserId;
            if (!associatedUserId) continue;

            const links = userConfig.config?.links ?? [];

            let searchItems: SearchItem[];

            //initially, its just an array of links
            searchItems = links.map(link => ({
                name: link.name,
                icon: link.icon,
                secondaryInfo: link.linkGroup,
                type: "link",
                action: `url:${link.url}`,
            }));

            //check if user has any integrations configured
            if (userConfig.config.integrations?.Karakeep) {
                const karakeepConfig = userConfig.config.integrations?.Karakeep;
                const token = Buffer.from(karakeepConfig.api_token, "base64").toString("utf-8");
                const serverUrl = Buffer.from(karakeepConfig.server_location, "base64").toString("utf-8");

                console.log("karakeep", token, serverUrl)
                if (!token || !serverUrl) return;

                const bookmarks = await KarakeepSearchItems({serverUrl, token, allowInsecureCerts:  config.allowInsecureCertsForIntegrationUrls});
                searchItems.push(...bookmarks);
            }

            const desiredJson = mapSearchItemsToJSON(searchItems);

            // Check for existing record
            const existing = await pb.collection("userSearchItems")
                .getFirstListItem<UserSearchItem>(`associatedUserId="${associatedUserId}"`)
                .catch(() => null);


            if (existing) {
                // Update only if different
                if (existing.searchItems !== desiredJson) {
                    await pb.collection("userSearchItems").update(existing.id!, {
                        searchItems: desiredJson,
                    });
                }
            } else {
                // Create new
                await pb.collection("userSearchItems").create({
                    associatedUserId,
                    searchItems: desiredJson,
                });
            }
        }
    } catch (error) {
        console.error("Error generating user search items:", error);
    }
}
