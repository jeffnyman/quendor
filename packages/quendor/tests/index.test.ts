import { expect, test } from "vite-plus/test";
import { fn } from "../src/index.ts";

test("fn", () => {
  expect(fn()).toBe("Quendor Z-Machine Interpreter and Debugger");
});
