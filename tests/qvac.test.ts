import { describe, expect, test } from "bun:test";
import { pickDevice } from "../server/qvac";

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
