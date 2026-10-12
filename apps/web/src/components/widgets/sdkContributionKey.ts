import type { SdkContributionKind } from "@/lib/apiClient";

export type SdkContributionAddress = {
  instanceId: string;
  kind: SdkContributionKind;
  contributionId: string;
};

export function parseSdkContributionKey(value: string): SdkContributionAddress | null {
  const match = value.match(/^(?:[^#]+#)?sdk#([^#]+)#(widget|glanceable)#(.+)$/);
  if (!match) return null;
  try {
    return {
      instanceId: match[1],
      kind: match[2] as SdkContributionKind,
      contributionId: decodeURIComponent(match[3]),
    };
  } catch {
    return null;
  }
}
