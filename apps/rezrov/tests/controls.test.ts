import { expect, test } from "vite-plus/test";
import { RunState } from "quendor";
import { computeControls } from "../web/controls.ts";

test("running: step/continue enabled, input disabled", () => {
  const c = computeControls(RunState.Running, null, "debug");
  expect(c.stepDisabled).toBe(false);
  expect(c.contDisabled).toBe(false);
  expect(c.inputDisabled).toBe(true);
  expect(c.focusInput).toBe(false);
});

test("halted: stepping and continuing are both disabled", () => {
  const c = computeControls(RunState.Halted, null, "debug");
  expect(c.stepDisabled).toBe(true);
  expect(c.contDisabled).toBe(true);
});

test("waiting for a line: step disabled, input enabled and focused", () => {
  const c = computeControls(RunState.WaitingForInput, "line", "debug");
  expect(c.stepDisabled).toBe(true);
  expect(c.contDisabled).toBe(false);
  expect(c.inputDisabled).toBe(false);
  expect(c.focusInput).toBe(true);
  expect(c.placeholder).toContain("type a command");
});

test("play mode key prompt disables the input box and shows a key hint", () => {
  const c = computeControls(RunState.WaitingForInput, "char", "play");
  expect(c.inputDisabled).toBe(true);
  expect(c.focusInput).toBe(false);
  expect(c.placeholder).toBe("press a key…");
});

test("play mode [MORE] prompt shows the more hint", () => {
  const c = computeControls(RunState.WaitingForInput, "more", "play");
  expect(c.inputDisabled).toBe(true);
  expect(c.placeholder).toContain("[MORE]");
});

test("debug mode leaves the line box usable even at a char prompt", () => {
  const c = computeControls(RunState.WaitingForInput, "char", "debug");
  expect(c.inputDisabled).toBe(false); // no play-mode key capture
  expect(c.focusInput).toBe(true);
});
