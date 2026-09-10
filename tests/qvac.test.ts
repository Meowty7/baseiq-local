import { describe, expect, test } from "bun:test";
import { isMissingModelError, pickDevice } from "../server/qvac";

describe("pickDevice", () => {
  test("env gana sobre el probe", () => {
    expect(pickDevice("cpu", true)).toBe("cpu");
    expect(pickDevice("GPU", false)).toBe("gpu");
  });
  test("sin env usa el probe", () => {
    expect(pickDevice(undefined, true)).toBe("gpu");
    expect(pickDevice(undefined, false)).toBe("cpu");
  });
});

test("detecta reinicio del worker por modelo perdido", () => {
  expect(isMissingModelError(new Error('Model with ID "abc123" not found'))).toBe(true);
  expect(isMissingModelError(new Error("infer_timeout"))).toBe(false);
});
