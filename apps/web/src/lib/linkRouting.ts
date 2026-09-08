export type RoutedLink = {
  url?: string;
  secondaryUrls?: Array<{ url?: string; routingRule?: string }>;
};

export function getRoutedLinkUrl(link: RoutedLink): string {
  const primaryUrl = String(link.url ?? "").trim();
  if (typeof window === "undefined" || !Array.isArray(link.secondaryUrls)) return primaryUrl;

  const origin = window.location.origin.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();
  const host = window.location.host.toLowerCase();
  const currentValues = [origin, hostname, host];

  for (const secondary of link.secondaryUrls) {
    const rule = String(secondary.routingRule ?? "").trim().toLowerCase().replace(/\/$/, "");
    if (!rule) continue;

    let matches = currentValues.includes(rule);
    if (!matches && rule.startsWith("*.")) matches = hostname.endsWith(rule.slice(1));
    if (!matches) {
      try {
        const ruleUrl = new URL(rule.includes("://") ? rule : `https://${rule}`);
        matches = [ruleUrl.origin, ruleUrl.hostname, ruleUrl.host]
          .map((value) => value.toLowerCase())
          .some((value) => currentValues.includes(value));
      } catch {
        // Ignore malformed rules.
      }
    }

    const secondaryUrl = String(secondary.url ?? "").trim();
    if (matches && secondaryUrl) return secondaryUrl;
  }

  return primaryUrl;
}
