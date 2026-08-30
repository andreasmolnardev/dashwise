export type ActivityShortcutResult = {
  success: boolean;
  error?: string;
};

export type ActivityShortcutHandler = () => Promise<ActivityShortcutResult | boolean> | ActivityShortcutResult | boolean;

const handlers = new Map<string, ActivityShortcutHandler>();

export function registerActivityShortcut(shortcutId: string, handler: ActivityShortcutHandler) {
  const normalizedId = shortcutId.trim();
  if (!normalizedId) throw new Error("A shortcut id is required");

  handlers.set(normalizedId, handler);
  return () => {
    if (handlers.get(normalizedId) === handler) handlers.delete(normalizedId);
  };
}

export async function executeRegisteredActivityShortcut(shortcutId: string): Promise<ActivityShortcutResult> {
  const handler = handlers.get(shortcutId);
  if (!handler) {
    return {
      success: false,
      error: "Shortcut is not registered on this client",
    };
  }

  try {
    const result = await handler();
    if (typeof result === "boolean") return { success: result };
    return result?.success === true
      ? { success: true }
      : { success: false, error: result?.error || "The client failed to execute the shortcut" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "The client failed to execute the shortcut",
    };
  }
}
