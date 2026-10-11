import type { HassState } from "./ha-types";

/** Convert the maintained client's keyed state map to an authoritative snapshot. */
export function parseEntitySnapshot(value: unknown): HassState[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Home Assistant returned an invalid entity snapshot");
  }
  const states: HassState[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`Home Assistant returned an invalid entity state for ${key}`);
    }
    const entity = item as Partial<HassState>;
    if (
      typeof entity.entity_id !== "string" ||
      entity.entity_id !== key ||
      typeof entity.state !== "string" ||
      typeof entity.attributes !== "object" ||
      entity.attributes === null ||
      Array.isArray(entity.attributes)
    ) {
      throw new Error(`Home Assistant returned an incomplete entity state for ${key}`);
    }
    states.push(entity as HassState);
  }
  return states;
}
