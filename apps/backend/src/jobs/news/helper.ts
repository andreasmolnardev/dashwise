import Parser from 'rss-parser';

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
        console.error(`Error fetching or parsing feed: ${feedUrl}`, error);
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

        // direct object with url
        if (typeof obj.url === 'string') return obj.url;

        return undefined;
    };

    // 1. media:thumbnail on item
    let url =
        extractUrl(item['media:thumbnail']) ||
        extractUrl(item.media?.thumbnail);

    if (url) return url;

    // 2. media:group thumbnails (YouTube)
    const mediaGroup = item['media:group'];
    if (mediaGroup) {
        url =
            extractUrl(mediaGroup['media:thumbnail']) ||
            extractUrl(mediaGroup.thumbnail);
        if (url) return url;

        // 3. media:content fallback
        url = extractUrl(mediaGroup['media:content']);
        if (url) return url;
    }

    // 4. enclosure
    if (item.enclosure?.url) {
        return item.enclosure.url;
    }

    // 5. HTML <img> fallback
    const html =
        item['content:encoded'] ||
        item.content ||
        item.summary ||
        item.description;

    if (typeof html === 'string') {
        return getFirstImageSource(html) ?? fallbackUrl;
    }

    return fallbackUrl;
}

export function getDescription(item: any): string | undefined {
    const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').trim();

    // 1. Try media:group → media:description (YouTube)
    const mediaGroup = item['media:group'];
    if (mediaGroup) {
        const mediaDesc = mediaGroup['media:description'] ?? mediaGroup.description;
        if (typeof mediaDesc === 'string') return stripHtml(mediaDesc);
        if (typeof mediaDesc === 'object') return stripHtml(mediaDesc[0]);
        // rss-parser sometimes wraps text in $?._
        if (mediaDesc?.$?._) return stripHtml(mediaDesc.$._);
    }

    // 2. Try item.description or item['content:encoded']
    if (typeof item.description === 'string') return stripHtml(item.description);
    if (typeof item['content:encoded'] === 'string') return stripHtml(item['content:encoded']);

    // 3. Fallback: summary or content
    if (typeof item.summary === 'string') return stripHtml(item.summary);
    if (typeof item.content === 'string') return stripHtml(item.content);

    return undefined;
}
