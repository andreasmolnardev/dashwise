import Parser from "rss-parser";

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

const FEED_REQUEST_HEADERS = {
    "User-Agent": "Dashwise RSS Reader (+https://github.com/andrew-d/dashwise)",
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
};

type ParserItem = Parser.Item & {
    author?: string;
    creator?: string;
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
    const parser = new Parser<any, ParserItem>({
        headers: FEED_REQUEST_HEADERS,
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
                description: truncateSentences(getBestDescription(item), 5),
                content: getContent(item),
                pubDate,
                thumbnailUrl: getThumbnail(item, thumbnailOverwriteUrl, fallbackThumbnailUrl || feed?.image?.url),
                author: item.author || (item as any).creator,
                source: feedName,
            } as FeedItem;
        })
        .filter((item: FeedItem) => !isNaN(item.pubDate.getTime()))
        .slice(0, maxItems);
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

function truncateSentences(value: string, maxSentences: number): string {
    const text = stripHtml(value).trim();
    if (!text) return "";

    const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [text];
    return sentences.slice(0, maxSentences).join(" ").replace(/\s+/g, " ").trim();
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

function getHtmlContentCandidates(item: ParserItem): string[] {
    const candidates: Array<string | { _: string } | undefined> = [
        item.content,
        item["content:encoded"],
        item.description,
        item.summary,
    ];

    return candidates
        .map((value: string | { _: string } | undefined) => {
            if (!value) return undefined;
            if (typeof value === "string") return value;
            return (value as any)._ ?? String(value);
        })
        .filter((value): value is string => Boolean(value));
}

function stripHtml(text?: unknown): string {
    const value =
        typeof text === "string"
            ? text
            : text && typeof text === "object" && "_" in text
              ? (text as { _: unknown })._
              : undefined;

    if (typeof value !== "string" || !value) return "";
    return decodeHtmlEntities(
        value
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
        ...getHtmlContentCandidates(item).map(firstImageSrc),
        fallback,
    ];

    return candidates.find((c) => c && /^https?:\/\//i.test(c));
}
