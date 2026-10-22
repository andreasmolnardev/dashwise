import { getFaviconFromHTML } from "./faviconFromDom";

export type LinkMetadata = {
  title: string;
  description: string;
  iconUrl: string;
};

const LINK_METADATA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; Dashwise link metadata)",
  Accept: "text/html,application/xhtml+xml",
};

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function getAttribute(tag: string, attribute: string) {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeHtmlEntities(match[1]).trim() : "";
}

function getMetaContent(tags: string[], names: string[]) {
  for (const tag of tags) {
    const name = getAttribute(tag, "property") || getAttribute(tag, "name");
    if (names.includes(name.toLowerCase())) {
      const content = getAttribute(tag, "content");
      if (content) return content;
    }
  }

  return "";
}

function getTitle(html: string) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return decodeHtmlEntities(title).replace(/\s+/g, " ").trim();
}

export async function getLinkMetadata(url: string): Promise<LinkMetadata> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Enter a valid URL to fetch link details");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }

  const response = await fetch(parsedUrl, {
    headers: LINK_METADATA_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch URL (${response.status})`);
  }

  const html = (await response.text()).slice(0, 2_000_000);
  const finalUrl = response.url || parsedUrl.href;
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const title = getMetaContent(metaTags, ["og:title", "twitter:title"]) || getTitle(html);
  const description = getMetaContent(metaTags, ["og:description", "twitter:description", "description"]);

  return {
    title: title || new URL(finalUrl).hostname,
    description,
    iconUrl: getFaviconFromHTML(html, finalUrl) ?? "",
  };
}
