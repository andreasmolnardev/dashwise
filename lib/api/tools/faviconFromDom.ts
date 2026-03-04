import { load } from "cheerio";

/**
 * Fetches a website and tries to extract its favicon URL from the DOM.
 * Falls back to /favicon.ico if none found.
 */
export async function getFaviconFromDOM(url, useRootPage = false) {
  try {
    const parsed = new URL(url);

    const targetUrl = useRootPage
      ? `${parsed.protocol}//${parsed.host}/`
      : url;

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);

    const iconSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
    ];

    for (const selector of iconSelectors) {
      const href = $(selector).attr("href");
      if (href) {
        return new URL(href, targetUrl).href;
      }
    }

    // fallback
    return new URL("/favicon.ico", targetUrl).href;

  } catch (error) {
    console.error("Error extracting favicon:", error);
    return null;
  }
}