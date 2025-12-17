import Parser from 'rss-parser';
import { JSDOM } from 'jsdom';

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

                // make description fallback: if no description but there's a summary, use summary
                const descriptionText = item.description || item.summary || undefined;

                let thumbnailUrl = '';

                if (item['media:thumbnail']) {
                    if (typeof item['media:thumbnail'] === 'object' && item['media:thumbnail'].$) {
                        thumbnailUrl = item['media:thumbnail'].$.url;
                    } else if (typeof item['media:thumbnail'] === 'string') {
                        thumbnailUrl = item['media:thumbnail'];
                    }
                }

                if (!thumbnailUrl && item.enclosure && item.enclosure.url) {
                    if (item.enclosure.type && item.enclosure.type.startsWith('image/')) {
                        thumbnailUrl = item.enclosure.url;
                    }
                }

                // fallback: scan content, content:encoded, description, summary (in that order) for an <img>
                if (!thumbnailUrl) {
                    const htmlToScan = getHtmlContent(item, true) ?? descriptionText;
                    const found = extractImageFromHtml(htmlToScan);
                    if (found) thumbnailUrl = found;
                }

                if (!thumbnailUrl && (feed as any).image && (feed as any).image.url) {
                    thumbnailUrl = (feed as any).image.url;
                }

                return {
                    ...item,
                    title: getTextContent(item.title) || 'No Title',
                    link: item.link || '',
                    description: filteredText(item.description || item.summary || (getHtmlContent(item) ?? item.content)) as string || undefined,
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
        console.error(`Error fetching or parsing feed: ${feedUrl}`, error.message);
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

function filteredText(text: string) {
    return text.replace(/<[^>]*>/g, "");
}

function getTextContent(text: string) {
  return new JSDOM(text).window.document.body.textContent ?? "";
}

// --- helper: extract first image URL from an HTML string ---
function extractImageFromHtml(html?: string): string | undefined {
    if (!html) return undefined;
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const img = doc.querySelector('img');
    if (!img) return undefined;
    return img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || undefined;
}
