export async function getFaviconFromDOM(url: string, useRootPage = false): Promise<string | null> {
  try {
    const parsedUrl = new URL(url);
    const targetUrl = useRootPage ? `${parsedUrl.protocol}//${parsedUrl.host}/` : url;

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    const iconMatch = html.match(
      /<link[^>]+rel=["'][^"']*(?:icon|shortcut icon|apple-touch-icon)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i
    );

    if (iconMatch?.[1]) {
      return new URL(iconMatch[1], targetUrl).href;
    }

    return new URL("/favicon.ico", targetUrl).href;
  } catch (error) {
    console.error("Error extracting favicon:", error);
    return null;
  }
}
