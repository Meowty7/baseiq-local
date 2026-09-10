import { describe, expect, test } from "bun:test";
import { isMissingModelError } from "../src/lib/qvac";

test("detecta reinicio del worker por modelo perdido", () => {
  expect(isMissingModelError(new Error('Model with ID "abc123" not found'))).toBe(true);
  expect(isMissingModelError(new Error("infer_timeout"))).toBe(false);
});
