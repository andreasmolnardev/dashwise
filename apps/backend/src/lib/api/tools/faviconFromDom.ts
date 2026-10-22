const PAGE_REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; Dashwise favicon resolver)",
  Accept: "text/html,application/xhtml+xml",
};

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(code, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, code: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(code, 10));
      } catch {
        return "";
      }
    });
}

function getAttribute(tag: string, attribute: string) {
  const match = tag.match(new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  return decodeHtmlEntities(value).trim();
}

/** Resolve a favicon declared by a page, without assuming a conventional path. */
export function getFaviconFromHTML(html: string, baseUrl: string): string | null {
  const candidates: Array<{ url: string; rank: number; size: number; order: number }> = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];

  linkTags.forEach((tag, order) => {
    const rel = getAttribute(tag, "rel").toLowerCase().split(/\s+/).filter(Boolean);
    const isIcon = rel.includes("icon");
    const isTouchIcon = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!isIcon && !isTouchIcon) return;

    const href = getAttribute(tag, "href");
    if (!href) return;

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;

      const sizes = getAttribute(tag, "sizes").match(/\d+/g)?.map(Number) ?? [];
      const size = sizes.length ? Math.max(...sizes) : 0;
      candidates.push({ url: resolved.href, rank: isIcon ? 2 : 1, size, order });
    } catch {
      // Ignore malformed icon links and try the next declaration.
    }
  });

  candidates.sort((left, right) => right.rank - left.rank || right.size - left.size || left.order - right.order);
  return candidates[0]?.url ?? null;
}

export async function getFaviconFromDOM(url: string, useRootPage = false): Promise<string | null> {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null;

    const targetUrl = useRootPage
      ? new URL("/", parsedUrl.origin).href
      : parsedUrl.href;
    const response = await fetch(targetUrl, {
      headers: PAGE_REQUEST_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;

    const html = (await response.text()).slice(0, 2_000_000);
    return getFaviconFromHTML(html, response.url || targetUrl);
  } catch (error) {
    console.error("Error extracting favicon:", error);
    return null;
  }
}
