import { describe, expect, test } from "bun:test";
import {
  applyStatefulShortcutAction,
  parseStatefulShortcutAction,
  type ShortcutState,
} from "./shortcuts";

const states: ShortcutState[] = [
  { id: "power", name: "Power", type: "boolean", value: false },
  { id: "volume", name: "Volume", type: "number", value: 10 },
];

describe("stateful shortcut actions", () => {
  test("parses toggle, set, increment, and decrement actions", () => {
    expect(parseStatefulShortcutAction("toggle:power")).toEqual({ operation: "toggle", stateId: "power" });
    expect(parseStatefulShortcutAction("set:power:true")).toEqual({ operation: "set", stateId: "power", value: true });
    expect(parseStatefulShortcutAction("increment:volume:2")).toEqual({ operation: "increment", stateId: "volume", amount: 2 });
    expect(parseStatefulShortcutAction("decrement:volume")).toEqual({ operation: "decrement", stateId: "volume", amount: 1 });
  });

  test("applies actions without mutating unrelated states", () => {
    const action = parseStatefulShortcutAction("toggle:power");
    expect(action).not.toBeNull();
    expect(applyStatefulShortcutAction(states, action!)).toEqual([
      { id: "power", name: "Power", type: "boolean", value: true },
      states[1],
    ]);
    expect(states[0].value).toBe(false);
  });
});
