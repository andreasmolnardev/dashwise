import type { SdkResourceIdentity } from "./sdkResourceSubscriptions";

type ShortcutWithAction = { action?: unknown };

export function getSdkShortcutResourceIdentities(
  shortcuts: readonly ShortcutWithAction[],
): SdkResourceIdentity[] {
  const identities = new Map<string, SdkResourceIdentity>();

  for (const shortcut of shortcuts) {
    const action = shortcut.action;
    if (!action || typeof action !== "object" || Array.isArray(action)) continue;

    const candidate = action as Record<string, unknown>;
    if (candidate.type !== "sdk-resource") continue;
    const { instanceId, collectionId, resourceId } = candidate;
    if (typeof instanceId !== "string" || !instanceId.trim()
      || typeof collectionId !== "string" || !collectionId.trim()
      || typeof resourceId !== "string" || !resourceId.trim()) continue;

    const identity = { instanceId, collectionId, resourceId };
    identities.set(JSON.stringify([instanceId, collectionId, resourceId]), identity);
  }

  return [...identities.values()];
}
