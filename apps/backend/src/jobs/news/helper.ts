import Parser from 'rss-parser';

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

type ParserItem = Parser.Item & FeedItem & {
    'media:thumbnail'?: { $: { url: string } } | string;
    enclosure?: { url: string; type: string };
};

export async function getFeedItems({
    feedUrl,
    maxItems = 100,
    feedName,
}: {
    feedUrl: string;
    maxItems?: number;
    feedName?: string | undefined;
}): Promise<FeedItem[]> {
    const parser = new Parser<any, FeedItem>({
        customFields: {
            item: [
                ['pubDate', 'pubDate'],
                ['dc:date', 'pubDate'],
                ['media:thumbnail', 'media:thumbnail'],
                ['media:group', 'media:group'],
                ['enclosure', 'enclosure'],
                ['content:encoded', 'content:encoded']
            ]
        }
    });

    try {
        const feed = await parser.parseURL(feedUrl);

        if (!feed.items || feed.items.length === 0) {
            return [];
        }

        const formattedItems = feed.items
            .map((item: ParserItem) => {
                const dateString = item.isoDate || item.pubDate;
                const thumbnailUrl = getThumbnail(item, feed?.image?.url);
                const descriptionText = getDescription(item);

                return {
                    title: getTextContent(item.title) || 'No Title',
                    link: item.link || '',
                    description: descriptionText || "",
                    content: (getHtmlContent(item) ?? item.content) as string | undefined,
                    pubDate: dateString ? new Date(dateString) : new Date(),
                    thumbnailUrl: thumbnailUrl || undefined,
                    author: item.author || item.creator || undefined,
                    source: feedName
                } as FeedItem;
            })
            .filter((item: FeedItem) => item.pubDate instanceof Date && !isNaN(item.pubDate.getTime()));

        return formattedItems.slice(0, maxItems);

    } catch (error: any) {
        logger.error(`Error fetching or parsing feed: ${feedUrl}`, error);
        return [];
    }
}

// get HTML content string from various fields ---
function getHtmlContent(item: ParserItem, priotizeEncode?: boolean) {
    // rss-parser sometimes provides content as string, sometimes as object { _ : 'html' } for XML
    let contentDescription;

    if (priotizeEncode === true) {
        contentDescription = (item['content:encoded'] ?? item.content ?? item.description ?? item.summary);
    } else {
        contentDescription = item.content ?? (item['content:encoded'] ?? item.description ?? item.summary);
    }

    if (!contentDescription) return undefined;

    if (typeof contentDescription === 'string') return contentDescription;
    // object with _ property
    if ((contentDescription as any)._ && typeof (contentDescription as any)._ === 'string') {
        return (contentDescription as any)._;
    }
    return String(contentDescription);
}

function getTextContent(text: string) {
    if (!text) {
        return "";
    }

    return decodeHtmlEntities(
        text
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
    );
}

function decodeHtmlEntities(text: string) {
    const namedEntities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
    };

    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
            const codePoint = Number.parseInt(entity.slice(2), 16);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }

        if (entity.startsWith("#")) {
            const codePoint = Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }

        return namedEntities[entity] ?? match;
    });
}

function getFirstImageSource(html: string) {
    const match = html.match(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? undefined;
}

export function getThumbnail(item: any, fallbackUrl?: any): string | undefined {
    // helper to extract URL from rss-parser style objects
    const extractUrl = (obj: any): string | undefined => {
        if (!obj) return undefined;

        // array form: [{ $: { url } }]
        if (Array.isArray(obj)) {
            for (const entry of obj) {
                const url = extractUrl(entry);
                if (url) return url;
            }
            return undefined;
        }

        // attribute form: { $: { url } }
        if (obj.$?.url) return obj.$.url;

        // direct string
        if (typeof obj === 'string') return obj;

        // common nested shapes
        if (obj.url) return obj.url;
        if (obj.href) return obj.href;
        if (obj._) return obj._;

        return undefined;
    };

    const candidates = [
        extractUrl(item?.["media:thumbnail"]),
        extractUrl(item?.["media:group"]),
        extractUrl(item?.enclosure),
        extractUrl(item?.thumbnail),
        extractUrl(item?.image),
        extractUrl(item?.logo),
        getFirstImageSource(item?.content || item?.description || item?.summary || ""),
        typeof fallbackUrl === 'string' ? fallbackUrl : extractUrl(fallbackUrl),
    ];

    for (const candidate of candidates) {
        if (candidate && /^https?:\/\//i.test(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function getDescription(item: ParserItem) {
    return item.description || item.summary || (typeof item.content === 'string' ? item.content : undefined) || (item as any)['content:encoded'];
}
