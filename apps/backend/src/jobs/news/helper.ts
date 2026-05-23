import Parser from "rss-parser";
import { createLogger } from "../../lib/logger";

export interface FeedItem {
    title: string;
    link: string;
    pubDate: Date;
    isoDate?: string;
    content?: string;
    thumbnailUrl?: string;
    description?: string;
    summary?: string;
    [key: string]: any;
}

const logger = createLogger("NewsFeedBuilder");

type ParserItem = Parser.Item & {
    "media:thumbnail"?:
        | { $: { url: string } }
        | Array<{ $: { url: string } }>
        | string;
    "media:group"?: any;
    "media:description"?: any;
    "content:encoded"?: string;
    "media:content"?:
    | { $: { url?: string; type?: string; medium?: string } }
    | Array<{ $: { url?: string; type?: string; medium?: string } }>;
    enclosure?: { url: string; type: string };
    description?: string | { _: string; $?: { type?: string } };
};

export async function getFeedItems({
    feedUrl,
    maxItems = 100,
    feedName,
    linkReplaceRule,
    thumbnailOverwriteUrl,
    fallbackThumbnailUrl,
}: {
    feedUrl: string;
    maxItems?: number;
    feedName?: string;
    linkReplaceRule?: Record<string, string>;
    thumbnailOverwriteUrl?: string;
    fallbackThumbnailUrl?: string;
}): Promise<FeedItem[]> {
    const logger = createLogger("NewsFeedBuilder");

    const parser = new Parser<any, ParserItem>({
        customFields: {
            item: [
                ["media:thumbnail", "media:thumbnail"],
                ["media:description", "media:description"],
                ["media:group", "media:group"],
                ["content:encoded", "content:encoded"],
                ["description", "description", { keepArray: false }],
                ["media:content", "media:content"],
            ],
        },
    });

    try {
        const feed = await parser.parseURL(feedUrl);
        if (!feed.items?.length) return [];

        return feed.items
            .map((item: ParserItem) => {
                const pubDate = new Date(item.isoDate || item.pubDate || "");
                
                let link = item.link || "";
                if (linkReplaceRule) {
                    for (const [search, replace] of Object.entries(linkReplaceRule)) {
                        link = link.replace(new RegExp(search, "g"), replace);
                    }
                }

                return {
                    title: stripHtml(item.title) || "No Title",
                    link,
                    description: getBestDescription(item),
                    content: getContent(item),
                    pubDate,
                    thumbnailUrl: getThumbnail(item, thumbnailOverwriteUrl, fallbackThumbnailUrl || feed?.image?.url),
                    author: item.author || (item as any).creator,
                    source: feedName,
                } as FeedItem;
            })
            .filter((item) => !isNaN(item.pubDate.getTime()))
            .slice(0, maxItems);
    } catch (error: any) {
        logger.error(`Error fetching or parsing feed: ${feedUrl}`, error);
        return [];
    }
}

function getDescription(item: ParserItem): string {
    const desc = item.description;
    if (!desc) return "";

    let value: string | undefined;

    if (typeof desc === "object") {
        value = desc._;
    } else {
        value = desc;
    }

    return stripHtml(value);
}

function getBestDescription(item: ParserItem): string {
    return (
        getDescription(item) ||
        item["media:group"]?.["media:description"] ||
        item["media:description"] ||
        item.summary ||
        ""
    );
}

function getContent(item: ParserItem): string | undefined {
    const raw =
        item.content ??
        item["content:encoded"] ??
        item.description ??
        item.summary;

    if (!raw) return undefined;

    if (typeof raw === "string") return raw;

    return (raw as any)._ ?? String(raw);
}

function stripHtml(text?: string): string {
    if (!text) return "";
    return decodeHtmlEntities(
        text
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
    );
}

function decodeHtmlEntities(text: string): string {
    const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
    };

    return text.replace(
        /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
        (match, entity: string) => {
            if (entity.startsWith("#x") || entity.startsWith("#X")) {
                return (
                    String.fromCodePoint(parseInt(entity.slice(2), 16)) ||
                    match
                );
            }
            if (entity.startsWith("#")) {
                return (
                    String.fromCodePoint(parseInt(entity.slice(1), 10)) ||
                    match
                );
            }
            return named[entity] ?? match;
        },
    );
}

function firstImageSrc(html: string): string | undefined {
    const m = html.match(
        /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
    );
    return m?.[1] ?? m?.[2] ?? m?.[3];
}

export function getThumbnail(
    item: ParserItem,
    overwrite?: string,
    fallback?: string,
): string | undefined {
    if (overwrite && /^https?:\/\//i.test(overwrite)) {
        return overwrite;
    }

    const mediaThumbnail =
        item["media:thumbnail"] ||
        item["media:group"]?.["media:thumbnail"];

    const fromMediaThumbnail = Array.isArray(mediaThumbnail)
        ? mediaThumbnail[0]?.$?.url
        : (mediaThumbnail as any)?.$?.url ??
          (typeof mediaThumbnail === "string"
              ? mediaThumbnail
              : undefined);

    const mediaContent =
        item["media:content"] ||
        item["media:group"]?.["media:content"];

    const fromMediaContent = Array.isArray(mediaContent)
        ? mediaContent.find(
              (m) =>
                  m?.$?.medium === "image" ||
                  m?.$?.type?.startsWith("image"),
          )?.$?.url ?? mediaContent[0]?.$?.url
        : mediaContent?.$?.url;

    const candidates = [
        fromMediaThumbnail,
        fromMediaContent,
        item.enclosure?.url,
        firstImageSrc(
            item.content || item.description || item.summary || "",
        ),
        fallback,
    ];

    return candidates.find((c) => c && /^https?:\/\//i.test(c));
}