import Parser from 'rss-parser';

// --- Type Definition ---
// Structure for a single item from an RSS feed
export interface FeedItem {
    title: string;
    link: string;
    pubDate: Date; // The JS Date object for sorting
    isoDate?: string; // The original string, for reference
    content?: string;
    [key: string]: any; // Allow other properties
}

// Define the expected structure of an item parsed by the RSS parser.
// This allows us to explicitly type the 'item' parameter in the map function.
type ParserItem = Parser.Item & FeedItem; 

/**
 * Fetches and parses an RSS/Atom feed from a given URL.
 *
 * @param feedUrl The URL of the RSS/Atom feed to fetch.
 * @param maxItems The maximum number of items to return from the feed.
 * @returns A promise that resolves to an array of FeedItem objects.
 */
export async function getFeedItems(feedUrl: string, maxItems: number = 100): Promise<FeedItem[]> {
    // Instantiate the parser, using 'any' for the feed object type and FeedItem for the item type.
    const parser = new Parser<any, FeedItem>({
        customFields: {
            item: [
                ['pubDate', 'pubDate'], // Standard RSS
                ['dc:date', 'pubDate'], // Dublin Core date
            ]
        }
    });

    try {
        // Fetch and parse the feed
        const feed = await parser.parseURL(feedUrl);

        if (!feed.items || feed.items.length === 0) {
            return [];
        }

        // Map items to our FeedItem structure and ensure pubDate is a Date object
        const formattedItems = feed.items
            // FIX 1: Explicitly type 'item' for .map()
            .map((item: ParserItem) => {
                // rss-parser provides isoDate, which is reliable for creating a Date
                const dateString = item.isoDate || item.pubDate;
                
                // The return value of this map is a FeedItem
                return {
                    ...item,
                    title: item.title || 'No Title',
                    link: item.link || '',
                    pubDate: dateString ? new Date(dateString) : new Date(), // Create Date object
                } as FeedItem; // Cast the result to the desired type
            })
            // FIX 2: Explicitly type 'item' for .filter(), which is the source of the TS7006 error on line 60.
            .filter((item: FeedItem) => item.pubDate instanceof Date && !isNaN(item.pubDate.getTime()));
        
        // Return the items, respecting the maxItems limit
        return formattedItems.slice(0, maxItems);

    } catch (error: any) {
        console.error(`Error fetching or parsing feed: ${feedUrl}`, error.message);
        return [];
    }
}