import { test, expect } from "vitest";
import { quendor } from "../src";

test("quendor", () => {
  expect(quendor()).toBe("Quendor");
});
