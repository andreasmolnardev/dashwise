import type { ShortcutState } from "@dashwise/types";
import { applyStatefulShortcutAction, parseStatefulShortcutAction } from "@dashwise/types";
import { getSuperuserPB } from "./pb/pocketbase";

export type SearchItemStateUpdate = {
  itemId: string;
  states: ShortcutState[];
};

type StateSubscriber = (update: SearchItemStateUpdate) => void;
const subscribers = new Map<string, Set<StateSubscriber>>();

export function subscribeSearchItemStates(userId: string, subscriber: StateSubscriber) {
  const current = subscribers.get(userId) ?? new Set<StateSubscriber>();
  current.add(subscriber);
  subscribers.set(userId, current);
  return () => {
    current.delete(subscriber);
    if (current.size === 0) subscribers.delete(userId);
  };
}

export function broadcastSearchItemState(userId: string, update: SearchItemStateUpdate) {
  for (const subscriber of subscribers.get(userId) ?? []) {
    try { subscriber(update); } catch { /* closed client */ }
  }
}

export async function executeSearchItemStateAction(userId: string, itemId: string, rawAction: unknown) {
  const action = parseStatefulShortcutAction(rawAction);
  if (!itemId || !action) return { success: false, error: "Invalid stateful shortcut action" };

  const pb = await getSuperuserPB();
  const record = await pb.collection("searchItems").getOne(itemId);
  if (!record || record.user !== userId) return { success: false, error: "Unauthorized" };

  const states = parseStates(record.states);
  if (!states.some((state) => state.id === action.stateId)) {
    return { success: false, error: "State not found" };
  }

  const nextStates = applyStatefulShortcutAction(states, action);
  if (JSON.stringify(states) === JSON.stringify(nextStates)) {
    return { success: false, error: "State cannot be updated by this action" };
  }

  await pb.collection("searchItems").update(itemId, { states: JSON.stringify(nextStates) });
  broadcastSearchItemState(userId, { itemId, states: nextStates });
  return { success: true, itemId, states: nextStates };
}

function parseStates(value: unknown): ShortcutState[] {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ShortcutState => {
    if (!entry || typeof entry !== "object") return false;
    const state = entry as Record<string, unknown>;
    return typeof state.id === "string" && typeof state.name === "string" &&
      typeof state.type === "string" &&
      (state.value === null || ["string", "number", "boolean"].includes(typeof state.value));
  });
}
