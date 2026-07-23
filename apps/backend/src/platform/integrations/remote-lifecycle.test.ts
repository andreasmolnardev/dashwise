import { expect, test } from "bun:test";
import {
  normalizeRemoteError,
  retryRemote,
  StreamRegistry,
} from "./remote-lifecycle";

test("normalizes aborted remote requests", () => {
  const error = normalizeRemoteError(new DOMException("aborted", "AbortError"));
  expect(error.kind).toBe("timeout");
});

test("retries transient remote failures", async () => {
  let calls = 0;
  const result = await retryRemote(async () => {
    calls++;
    if (calls === 1) throw new Error("connection reset");
    return "ok";
  }, { attempts: 2 });
  expect(result).toBe("ok");
  expect(calls).toBe(2);
});

test("stream registry replaces and closes registered streams", () => {
  const registry = new StreamRegistry<string>();
  let first = 0;
  let second = 0;
  registry.register("host", () => first++);
  registry.register("host", () => second++);
  registry.closeAll();
  expect(first).toBe(1);
  expect(second).toBe(1);
});
