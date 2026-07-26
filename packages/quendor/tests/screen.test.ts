import { expect, test } from "vite-plus/test";
import { Screen, TextStyle } from "../src/screen.ts";

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

test("setCursor positions the upper-window cursor (0-based)", () => {
  const screen = new Screen(10);

  screen.setCursor(2, 5);

  expect(screen.cursorRow).toBe(2);
  expect(screen.cursorCol).toBe(5);
});

test("splitWindow homes the cursor when it falls outside the shrunk upper window", () => {
  const screen = new Screen(10);

  screen.setCursor(5, 3); // cursor deep in a taller window
  screen.splitWindow(2, true); // now only 2 rows -> row 5 is out of range

  expect(screen.cursorRow).toBe(0);
  expect(screen.cursorCol).toBe(0);
});

test("print to the upper window is a no-op when the cursor is past the last row", () => {
  const screen = new Screen(10);

  screen.splitWindow(1, true); // one upper row
  screen.setWindow(1); // homes the cursor to (0,0)
  screen.setCursor(3, 0); // then move it beyond the single row
  screen.print("x"); // guarded: no row to stamp into

  expect(screen.upperRows()[0].trimEnd()).toBe(""); // nothing written
});

test("splitWindow without clearing preserves existing upper rows (v4+ behavior)", () => {
  const screen = new Screen(10);
  screen.splitWindow(2, true);
  screen.setWindow(1);
  screen.print("keep"); // upper[0] = "keep..."

  screen.splitWindow(2, false); // re-split without clearing

  expect(screen.upperRows()[0].trimEnd()).toBe("keep"); // row carried over
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

test("eraseWindow(-2) blanks the upper grid and clears the lower window, staying split", () => {
  const screen = statusScreen(2);
  let cleared = 0;
  screen.onClearLower = (): void => {
    cleared++;
  };

  screen.eraseWindow(-2);

  expect(cleared).toBe(1); // lower window cleared
  expect(screen.upperHeight).toBe(2); // still split (unlike -1)
  expect(screen.upperRows().every((r) => r.trim() === "")).toBe(true); // upper grid blanked
});

test("eraseWindow with an unknown window is a harmless no-op that still repaints", () => {
  const screen = statusScreen(1);
  let cleared = 0;
  let updates = 0;
  screen.onClearLower = (): void => {
    cleared++;
  };
  screen.onUpperUpdate = (): void => {
    updates++;
  };

  screen.eraseWindow(2); // not -2/-1/1/0

  expect(cleared).toBe(0); // nothing cleared
  expect(screen.upperRows()[0].trimEnd()).toBe("status"); // upper untouched
  expect(updates).toBe(1); // repaint hook still fires
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

test("setStatusLine composes a width-wide v3 bar: location left, status right", () => {
  const screen = new Screen(40);
  screen.setStatusLine("West of House", "Score: 0  Moves: 0");

  expect(screen.statusLine).toHaveLength(40);
  expect(screen.statusLine?.startsWith(" West of House")).toBe(true);
  // the status is right-aligned (a trailing pad space follows it)
  expect(screen.statusLine?.trimEnd().endsWith("Score: 0  Moves: 0")).toBe(true);
});

test("setStatusLine truncates to the screen width when both sides can't fit", () => {
  const screen = new Screen(20);
  screen.setStatusLine("A Long Location Name", "Score: 999  Moves: 999");

  expect(screen.statusLine).toHaveLength(20);
  expect(screen.statusLine?.startsWith(" A Long")).toBe(true);
});

test("the default host callbacks are harmless no-ops before a host wires them up", () => {
  const screen = new Screen(10);

  // No onLowerOutput / onClearLower installed: routing text and erasing must not throw.
  expect(() => screen.print("hi")).not.toThrow(); // default onLowerOutput
  expect(() => screen.eraseWindow(0)).not.toThrow(); // default onClearLower
});

test("reset returns the screen to its initial state", () => {
  const screen = new Screen(10);
  screen.splitWindow(3, true);
  screen.setWindow(1);
  screen.setCursor(1, 2);
  screen.style = TextStyle.Bold;
  screen.foreground = 5;
  screen.background = 6;
  screen.setStatusLine("Loc", "Score");

  screen.reset();

  expect(screen.upperHeight).toBe(0);
  expect(screen.upper).toEqual([]);
  expect(screen.currentWindow).toBe(0);
  expect(screen.style).toBe(TextStyle.Roman);
  expect(screen.cursorRow).toBe(0);
  expect(screen.cursorCol).toBe(0);
  expect(screen.foreground).toBe(1); // back to the default color
  expect(screen.background).toBe(1);
  expect(screen.statusLine).toBeNull();
});
