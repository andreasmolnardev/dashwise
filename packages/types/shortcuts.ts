export type ShortcutStateValue = string | number | boolean | null;

export type ShortcutState = {
  id: string;
  name: string;
  type: string;
  value: ShortcutStateValue;
};

export type StatefulShortcutAction =
  | { operation: "toggle"; stateId: string }
  | { operation: "set"; stateId: string; value: ShortcutStateValue }
  | { operation: "increment" | "decrement"; stateId: string; amount: number };

export function parseStatefulShortcutAction(raw: unknown): StatefulShortcutAction | null {
  if (typeof raw !== "string") return null;
  const [operation, stateId, ...rest] = raw.trim().split(":");
  if (!operation || !stateId) return null;

  const normalizedOperation = operation.toLowerCase();
  if (normalizedOperation === "toggle") {
    return { operation: "toggle", stateId };
  }

  if (normalizedOperation === "set") {
    if (rest.length === 0) return null;
    return { operation: "set", stateId, value: parseStateValue(rest.join(":")) };
  }

  if (normalizedOperation === "increment" || normalizedOperation === "decrement") {
    const amount = rest.length > 0 && rest[0] !== "" ? Number(rest[0]) : 1;
    if (!Number.isFinite(amount)) return null;
    return { operation: normalizedOperation, stateId, amount };
  }

  return null;
}

export function parseStateValue(raw: string): ShortcutStateValue {
  const trimmed = raw.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

export function applyStatefulShortcutAction(
  states: ShortcutState[],
  action: StatefulShortcutAction,
): ShortcutState[] {
  return states.map((state) => {
    if (state.id !== action.stateId) return state;

    if (action.operation === "toggle") {
      if (state.type === "boolean" || typeof state.value === "boolean") {
        const current = typeof state.value === "string"
          ? ["true", "on", "1", "yes"].includes(state.value.toLowerCase())
          : Boolean(state.value);
        return { ...state, value: !current };
      }
      if (state.type === "number" || typeof state.value === "number") {
        return { ...state, value: Number(state.value) === 0 ? 1 : 0 };
      }
      return { ...state, value: String(state.value).toLowerCase() === "on" ? "off" : "on" };
    }

    if (action.operation === "set") {
      return { ...state, value: action.value };
    }

    const current = Number(state.value);
    if (!Number.isFinite(current)) return state;
    const delta = action.operation === "increment" ? action.amount : -action.amount;
    return { ...state, value: current + delta };
  });
}
