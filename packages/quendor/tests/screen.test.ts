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
  screen.setFont(3);
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
  expect(screen.font).toBe(1); // back to the normal font
  expect(screen.statusLine).toBeNull();
});

// set_color / set_font: attribute state that flows into printed cells, exactly
// like style — the model keeps color and font on the screen, not the machine.

test("setColor sets fg/bg, treating 0 as 'leave unchanged'", () => {
  const screen = new Screen(10);

  screen.setColor(4, 6);
  expect(screen.foreground).toBe(4);
  expect(screen.background).toBe(6);

  screen.setColor(0, 2); // 0 = leave the foreground as it was
  expect(screen.foreground).toBe(4);
  expect(screen.background).toBe(2);

  screen.setColor(7, 0); // 0 = leave the background as it was
  expect(screen.foreground).toBe(7);
  expect(screen.background).toBe(2);
});

test("setFont switches font and returns the previous one; 0 when unavailable", () => {
  const screen = new Screen(10);

  expect(screen.setFont(3)).toBe(1); // was normal, now character graphics
  expect(screen.font).toBe(3);
  expect(screen.setFont(4)).toBe(3); // fixed-pitch is available on a monospace grid
  expect(screen.font).toBe(4);
  expect(screen.setFont(2)).toBe(0); // font 2 unavailable — font unchanged
  expect(screen.font).toBe(4);
});

test("printed cells carry the current font", () => {
  const screen = new Screen(10, 4);

  screen.setFont(3);
  screen.print("x"); // lower window

  expect(screen.grid[0][0].font).toBe(3);
});

// --- grid model: lower window, scrolling, and paging -----------------------
//
// The lower window is laid onto the same cell grid as the upper window (as well
// as being streamed to onLowerOutput). It wraps at the right edge and scrolls its
// own region, and content persists across splits — which is what lets a game draw
// in a tall upper window, shrink it, and keep the drawing (Std §8.7.2.1/2).

/** A grid row as a right-trimmed string. */
function gridRow(screen: Screen, row: number): string {
  return screen.grid[row]
    .map((c) => c.ch)
    .join("")
    .replace(/\s+$/, "");
}

test("lower-window text is laid onto the grid, wrapping at the right edge", () => {
  const screen = new Screen(5, 4);

  screen.print("abcdefg"); // width 5 -> "abcde" then wrap to "fg"

  expect(gridRow(screen, 0)).toBe("abcde");
  expect(gridRow(screen, 1)).toBe("fg");
});

test("a newline advances the lower cursor to the next row", () => {
  const screen = new Screen(10, 4);

  screen.print("a\nb");

  expect(gridRow(screen, 0)).toBe("a");
  expect(gridRow(screen, 1)).toBe("b");
});

test("the lower window scrolls its region when text reaches the bottom", () => {
  const screen = new Screen(10, 3);

  screen.print("one\ntwo\nthree\nfour"); // "one" scrolls off the top

  expect(gridRow(screen, 0)).toBe("two");
  expect(gridRow(screen, 1)).toBe("three");
  expect(gridRow(screen, 2)).toBe("four");
});

test("onMore fires once a screenful has scrolled by, and resetPaging clears the count", () => {
  const screen = new Screen(10, 4); // lower height 4 -> paging threshold 3 scrolls
  let more = 0;
  screen.onMore = (): void => {
    more++;
  };

  screen.print("\n".repeat(6)); // 6 newlines -> 3 scrolls -> one [More]

  expect(more).toBe(1);
  expect(screen.linesSinceInput).toBe(0); // reset when it fired

  screen.print("\n\n\n\n"); // one more scroll
  expect(screen.linesSinceInput).toBe(1);
  screen.resetPaging();
  expect(screen.linesSinceInput).toBe(0);
});

test("shrinking a v4/5 split keeps whatever was drawn in the upper window (the All Roads fix)", () => {
  const screen = new Screen(20, 15);

  screen.splitWindow(10, false); // a tall upper window
  screen.setWindow(1);
  screen.setCursor(3, 2);
  screen.print("BOX"); // drawn at upper row 3

  screen.splitWindow(1, false); // shrink to one row — must NOT discard row 3

  expect(screen.upperHeight).toBe(1);
  expect(gridRow(screen, 3)).toBe("  BOX"); // still on the grid, as a backdrop
});

test("a v3 split (clear=true) blanks the upper region", () => {
  const screen = new Screen(20, 15);

  screen.splitWindow(5, false);
  screen.setWindow(1);
  screen.setCursor(2, 0);
  screen.print("OLD");

  screen.splitWindow(5, true); // v3-style: clears the upper window

  expect(gridRow(screen, 2)).toBe("");
});

test("a split pushes the lower cursor below the new upper window", () => {
  const screen = new Screen(10, 10);

  screen.print("l0\nl1\nl2"); // lower cursor ends on row 2
  screen.splitWindow(5, false); // upper window swallows rows 0-4, incl. the cursor
  screen.setWindow(0);
  screen.print("X"); // must land below the upper window, not on row 2

  expect(gridRow(screen, 5)).toBe("X");
});

test("lowerCursor exposes the lower window's cursor position", () => {
  const screen = new Screen(10, 4);

  screen.print("ab\ncd"); // "ab" on row 0, newline, "cd" on row 1

  expect(screen.lowerCursor).toEqual({ row: 1, col: 2 });
});

test("the default onMore is a harmless no-op when a screenful scrolls by", () => {
  const screen = new Screen(10, 3); // paging threshold of 2 scrolls

  expect(() => screen.print("\n\n\n\n")).not.toThrow(); // 2 scrolls -> default onMore fires
});
