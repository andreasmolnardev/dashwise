
import https from "https";
import axios from "axios";
import { SearchItem } from "@/lib/jobs";

type KarakeepBookmark = {
  id: string;
  title: string;
  icon?: string;
  collection?: string;
  url: string;
  [key: string]: any;
};

/**
 * Fetch bookmarks from a Karakeep server.
 * - `serverUrl` should be the site root like "https://karakeep.mydomain.duckdns.org"
 *   (this function will append "/api/v1" to match the OpenAPI server template).
 * - If `token` is provided it will be used as a Bearer token.
 *
 * Returns an array of KarakeepBookmark objects (best-effort: supports several response shapes).
 */
export async function getBookmarks({
  serverUrl,
  token,
  allowInsecureCerts = false,
}: {
  serverUrl: string;
  token?: string | null;
  allowInsecureCerts?: boolean;
}): Promise<KarakeepBookmark[]> {
  try {
    const apiBase = serverUrl.replace(/\/+$/, "") + "/api/v1";

    //test karakeep connectivity
    try {
      await axios.get(serverUrl, {
        timeout: 3000,
        httpsAgent: allowInsecureCerts ? new https.Agent({ rejectUnauthorized: false }) : undefined,
      });
      console.log("Karakeep is reachable")
    } catch {
      console.error(`[Karakeep] ${serverUrl} not reachable.`);
      return [];
    }

    const url = `${apiBase}/bookmarks`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await axios.get(url, {
      headers,
      httpsAgent: allowInsecureCerts ? new https.Agent({ rejectUnauthorized: false }) : undefined,
    });

    const body = res.data;
    if (!body) return [];

    // normalize to an array of raw bookmark objects
    let rawArray: any[] = [];
    if (Array.isArray(body)) rawArray = body;
    else if (Array.isArray(body.items)) rawArray = body.items;
    else if (Array.isArray(body.bookmarks)) rawArray = body.bookmarks;
    else if (Array.isArray(body.data)) rawArray = body.data;
    else if (typeof body === "object" && body !== null && 'id' in body) rawArray = [body];
    else rawArray = [];

    // keep only link-type content and map to base bookmark objects
    const baseBookmarks: KarakeepBookmark[] = rawArray
      .filter(raw => raw && raw.content && raw.content.type === "link")
      .map(raw => {
        const title = raw.content?.title ?? raw.title ?? "Untitled";
        const urlStr = raw.content?.url ?? raw.url;
        return {
          id: raw.id,
          title,
          icon: raw.content?.favicon ?? raw.icon,
          collection: raw.collection ?? raw.collectionName,
          url: urlStr,
          content: raw.content,
          // lists will be filled below
        } as KarakeepBookmark;
      })
      .filter(b => !!b.url); // drop entries without a usable url

    if (baseBookmarks.length === 0) return [];

    // fetch lists for each bookmark in parallel and attach them
    await Promise.all(
      baseBookmarks.map(async (b) => {
        try {
          const listsRes = await axios.get(`${apiBase}/bookmarks/${b.id}/lists`, {
            headers,
            httpsAgent: allowInsecureCerts ? new https.Agent({ rejectUnauthorized: false }) : undefined,
          });

          const data = listsRes.data;
          const lists = Array.isArray(data?.lists) ? data.lists : [];

          // use only the first list name if present
          if (lists.length > 0) {
            const first = lists[0];
            b.collection = first.name ?? first.id;
          }
        } catch {
          // ignore network or 404 errors silently
        }
      })
    );


    return baseBookmarks;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(`[Karakeep] Failed to fetch bookmarks from ${serverUrl}`, {
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
        message: err.message,
      });
    } else {
      console.error(`[Karakeep] Unexpected error fetching bookmarks:`, err);
    }
    return [];
  }

}


/**
 * Map a user's Karakeep bookmarks into the `SearchItem[]` format.
 * - Returns an array of SearchItem suitable to be merged into your `searchItems` array.
 *
 * Example usage:
 * const kkItems = await KarakeepSearchItems({ serverUrl: 'https://try.karakeep.app', token });
 * searchItems.push(...kkItems);
 */
export async function KarakeepSearchItems({
  serverUrl,
  token,
  allowInsecureCerts
}: {
  serverUrl: string;
  token?: string | null;
  allowInsecureCerts: boolean;
}): Promise<SearchItem[]> {
  const bookmarks = await getBookmarks({ serverUrl, token, allowInsecureCerts });

  const mapped: SearchItem[] = bookmarks.map(b => ({
    id: b.id,
    name: b.title ?? "Untitled",
    icon: b.icon ?? "link",
    secondaryInfo: b.collection ?? "",
    type: "karakeepBookmark",
    action: `url:${b.url}`,
    tags: [b.title, "karakeep", b.collection].filter((t): t is string => !!t)
  }));

  // keep deterministic ordering
  return mapped.sort((a, b) => a.name.localeCompare(b.name));
}
