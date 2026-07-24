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
