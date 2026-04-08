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

type ParserItem = Parser.Item & {
    'media:thumbnail'?: { $: { url: string } } | Array<{ $: { url: string } }> | string;
    'media:group'?: any;
    'content:encoded'?: string;
    enclosure?: { url: string; type: string };
};

export async function getFeedItems({
    feedUrl,
    maxItems = 100,
    feedName,
}: {
    feedUrl: string;
    maxItems?: number;
    feedName?: string;
}): Promise<FeedItem[]> {
    const logger = createLogger("NewsFeedBuilder");
    const parser = new Parser<any, ParserItem>({
        customFields: {
            item: [
                ['media:thumbnail', 'media:thumbnail'],
                ['media:group', 'media:group'],
                ['content:encoded', 'content:encoded'],
            ]
        }
    });

    try {
        const feed = await parser.parseURL(feedUrl);
        if (!feed.items?.length) return [];

        logger.info(`Fetched ${feed.items.length} items from feed: ${feedUrl}`);

        return feed.items
            .map((item: ParserItem) => {
                const pubDate = new Date(item.isoDate || item.pubDate || '');
                return {
                    title: stripHtml(item.title) || 'No Title',
                    link: item.link || '',
                    description: item.description || item.summary || '',
                    content: getContent(item),
                    pubDate,
                    thumbnailUrl: getThumbnail(item, feed?.image?.url),
                    author: item.author || (item as any).creator,
                    source: feedName,
                } as FeedItem;
            })
            .filter(item => !isNaN(item.pubDate.getTime()))
            .slice(0, maxItems);

    } catch (error: any) {
        logger.error(`Error fetching or parsing feed: ${feedUrl}`, error);
        return [];
    }
}

function getContent(item: ParserItem): string | undefined {
    const raw = item.content ?? item['content:encoded'] ?? item.description ?? item.summary;
    if (!raw) return undefined;
    if (typeof raw === 'string') return raw;
    return (raw as any)._ ?? String(raw);
}

function stripHtml(text?: string): string {
    if (!text) return '';
    return decodeHtmlEntities(
        text
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

function decodeHtmlEntities(text: string): string {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
        if (entity.startsWith('#x') || entity.startsWith('#X'))
            return String.fromCodePoint(parseInt(entity.slice(2), 16)) || match;
        if (entity.startsWith('#'))
            return String.fromCodePoint(parseInt(entity.slice(1), 10)) || match;
        return named[entity] ?? match;
    });
}

function firstImageSrc(html: string): string | undefined {
    const m = html.match(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    return m?.[1] ?? m?.[2] ?? m?.[3];
}

export function getThumbnail(item: ParserItem, fallback?: string): string | undefined {
    // rss-parser hoists media:thumbnail to top level via customFields,
    // giving us: { $: { url } } or [{ $: { url } }]
    const mediaThumbnail = item['media:thumbnail'];
    const fromMediaThumbnail = Array.isArray(mediaThumbnail)
        ? mediaThumbnail[0]?.$?.url
        : (mediaThumbnail as any)?.$?.url ?? (typeof mediaThumbnail === 'string' ? mediaThumbnail : undefined);

    const candidates = [
        fromMediaThumbnail,
        item.enclosure?.url,
        firstImageSrc(item.content || item.description || item.summary || ''),
        fallback,
    ];

    return candidates.find(c => c && /^https?:\/\//i.test(c));
}