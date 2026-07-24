import { expect, test } from "vite-plus/test";
import { Screen } from "../src/screen.ts";

// Screen.print routes by the selected window: window 0 (lower) is the scrolling
// transcript via onLowerOutput; window 1 (upper) is the fixed status grid. The
// v4 status-line leak was the machine's print() bypassing this and always
// hitting the lower sink, so upper-window text landed in the transcript.

test("lower-window text is sent to onLowerOutput", () => {
  const screen = new Screen(80);
  let out = "";
  screen.onLowerOutput = (text): void => {
    out += text;
  };

  screen.print("hello");

  expect(out).toBe("hello");
});

test("upper-window text is stamped into the grid, not leaked to the transcript", () => {
  const screen = new Screen(80);
  let lower = "";
  screen.onLowerOutput = (text): void => {
    lower += text;
  };

  screen.splitWindow(1, true);
  screen.setWindow(1); // homes the cursor to (0,0)
  screen.print("At End Of Road");

  expect(lower).toBe(""); // the bug: this used to leak into the transcript
  expect(
    screen.upper[0]
      .map((c) => c.ch)
      .join("")
      .trimEnd(),
  ).toBe("At End Of Road");
});

test("upper-window writes clip at the right edge (no scroll)", () => {
  const screen = new Screen(5);

  screen.splitWindow(1, true);
  screen.setWindow(1);
  screen.print("toolong");

  expect(screen.upper[0].map((c) => c.ch).join("")).toBe("toolo");
});

test("upperRows renders each row as a full-width string for the host", () => {
  const screen = new Screen(10);

  screen.splitWindow(1, true);
  screen.setWindow(1);
  screen.print("Score: 10");

  expect(screen.upperRows()).toEqual(["Score: 10 "]); // padded to width 10
});

// erase_window routing: which windows fire onClearLower (the host's clear signal)
// vs. only blank the upper grid. This is the exact behavior the CLI relies on.

function statusScreen(rows: number): Screen {
  const screen = new Screen(10);
  screen.splitWindow(rows, true);
  screen.setWindow(1);
  screen.print("status");
  return screen;
}

test("eraseWindow(0) clears the lower window via onClearLower, leaving the upper grid", () => {
  const screen = statusScreen(1);
  let cleared = 0;
  screen.onClearLower = (): void => {
    cleared++;
  };

  screen.eraseWindow(0);

  expect(cleared).toBe(1); // lower window cleared
  expect(screen.upperHeight).toBe(1); // upper window untouched
  expect(screen.upperRows()[0].trimEnd()).toBe("status"); // its content preserved
});

test("eraseWindow(1) blanks the upper grid without touching the lower window", () => {
  const screen = statusScreen(1);
  let cleared = 0;
  screen.onClearLower = (): void => {
    cleared++;
  };

  screen.eraseWindow(1);

  expect(cleared).toBe(0); // lower window NOT cleared
  expect(screen.upperRows()[0].trimEnd()).toBe(""); // upper grid blanked
});

test("eraseWindow(-1) unsplits, empties the upper grid, and clears the lower window", () => {
  const screen = statusScreen(2);
  let cleared = 0;
  screen.onClearLower = (): void => {
    cleared++;
  };

  screen.eraseWindow(-1);

  expect(cleared).toBe(1); // lower window cleared
  expect(screen.upperHeight).toBe(0); // unsplit
  expect(screen.upperRows()).toEqual([]); // grid emptied
});

// onUpperUpdate lets the host repaint the upper window the moment it changes,
// not just at the next input prompt — the only way to catch a quote box that a
// game draws and tears down between prompts.

test("onUpperUpdate fires on the structural upper-window ops", () => {
  const screen = new Screen(10);
  let updates = 0;
  screen.onUpperUpdate = (): void => {
    updates++;
  };

  screen.splitWindow(3, true);
  screen.setWindow(1);
  screen.eraseWindow(1);

  expect(updates).toBe(3);
});
