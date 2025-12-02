import Parser from 'rss-parser';

export interface FeedItem {
    title: string;
    link: string;
    pubDate: Date;
    isoDate?: string;
    content?: string;
    thumbnailUrl?: string;
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
                return {
                    ...item,
                    title: item.title || 'No Title',
                    link: item.link || '',
                    pubDate: dateString ? new Date(dateString) : new Date(),
                    thumbnailUrl: thumbnailUrl || undefined,
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