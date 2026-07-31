import { expect, test } from "vite-plus/test";
import { V6Screen, WindowProp } from "../src/v6screen.ts";

// Unit tests for the v6 (YZIP) screen model: absolute-pixel span layout, word
// wrap, scrolling, and the [More] pause. V6Screen is self-contained (no Machine
// needed) — it takes text and produces positioned `spans` a renderer replays.
//
// Span coordinates are absolute pixels: x = (XPos-1) + (XCursor-1),
// y = (YPos-1) + (YCursor-1). Window 0 is the wrapping/scrolling main window;
// its words are only emitted once a space or newline flushes the pending word.

// --- character metrics -----------------------------------------------------

test("charWidth returns the tuned per-glyph widths for an 8px font", () => {
  const s = new V6Screen(320, 200, 8, 8);

  expect(s.charWidth(" ".charCodeAt(0))).toBe(3);
  expect(s.charWidth("i".charCodeAt(0))).toBe(2);
  expect(s.charWidth("m".charCodeAt(0))).toBe(7);
  expect(s.charWidth("A".charCodeAt(0))).toBe(6); // uppercase
  expect(s.charWidth("x".charCodeAt(0))).toBe(4); // lowercase default
});

test("charWidth scales with the font height", () => {
  const s = new V6Screen(320, 200, 8, 16); // double-height font

  expect(s.charWidth("m".charCodeAt(0))).toBe(14); // round(7 * 16 / 8)
  expect(s.charWidth("A".charCodeAt(0))).toBe(12); // round(6 * 16 / 8)
});

test("textWidth sums its characters' widths", () => {
  const s = new V6Screen(320, 200, 8, 8);

  expect(s.textWidth("AA")).toBe(12); // 6 + 6
  expect(s.textWidth("mi")).toBe(9); // 7 + 2
});

// --- span layout -----------------------------------------------------------

test("a completed word in the main window emits one span at the origin", () => {
  const s = new V6Screen();

  s.print("hi\n"); // newline flushes the pending word

  expect(s.spans.length).toBe(1);
  expect(s.spans[0].text).toBe("hi");
  expect(s.spans[0].x).toBe(0);
  expect(s.spans[0].y).toBe(0);
});

test("a word with no trailing space or newline stays pending (nothing emitted yet)", () => {
  const s = new V6Screen();

  s.print("hello"); // no flush trigger

  expect(s.spans.length).toBe(0);
});

test("the main window's prose mirrors to onLowerText once, for window 0 only", () => {
  const s = new V6Screen();
  const seen: string[] = [];
  s.onLowerText = (t): void => {
    seen.push(t);
  };

  s.print("hi\n");
  expect(seen).toEqual(["hi\n"]); // window 0 mirrors the full text

  s.current = 1; // upper window: span-only, no transcript mirror
  s.print("up");
  expect(seen).toEqual(["hi\n"]); // unchanged
});

// --- word wrap -------------------------------------------------------------

test("text wider than the window wraps onto multiple lines", () => {
  const s = new V6Screen(40, 200, 8, 8); // narrow: forces wrapping

  s.print("aaaa bbbb cccc dddd\n");

  const ys = new Set(s.spans.map((sp) => sp.y));
  expect(ys.size).toBeGreaterThan(1); // words landed on more than one line
});

// --- scrolling -------------------------------------------------------------

test("a full scrolling window drops the spans that pass above its top", () => {
  const s = new V6Screen(320, 24, 8, 8); // three lines tall (24 / 8)

  s.print("a\nb\nc\nd\ne\n");

  const texts = s.spans.map((sp) => sp.text);
  expect(texts).not.toContain("a"); // earliest lines scrolled off the top
  expect(texts).toContain("e"); // the newest line survives
  expect(s.needsMore).toBe(false); // no [More] pause without moreEnabled
});

// --- [More] pause ----------------------------------------------------------

test("with [More] enabled, filling the window latches needsMore and holds the rest back", () => {
  const s = new V6Screen(320, 24, 8, 8);
  s.moreEnabled = true; // moreLimit = floor(24/8) - 1 = 2

  s.print("a\nb\nc\nd\ne\n");

  expect(s.needsMore).toBe(true);
  const texts = s.spans.map((sp) => sp.text);
  expect(texts).toContain("b"); // placed before the window filled
  expect(texts).not.toContain("c"); // held behind the [More]
  expect(texts).not.toContain("e");
});

test("once [More] is latched, further text is buffered — no auto-reset yet (WIP)", () => {
  const s = new V6Screen(320, 24, 8, 8);
  s.moreEnabled = true;
  s.print("a\nb\nc\nd\ne\n"); // trips needsMore

  const before = s.spans.length;
  s.print("more text\n");

  // No reveal/reset API exists yet, so needsMore stays latched and the new text
  // is buffered rather than placed. Update this test when reveal is implemented.
  expect(s.spans.length).toBe(before);
  expect(s.needsMore).toBe(true);
});

// --- window sizing ---------------------------------------------------------

test("shrinking a window below its cursor snaps the cursor back to the origin", () => {
  const s = new V6Screen();
  const w = s.windows[2];
  w[WindowProp.YCursor] = 10;
  w[WindowProp.XCursor] = 10;

  s.windowSize(2, 5, 5);

  expect(w[WindowProp.YSize]).toBe(5);
  expect(w[WindowProp.XSize]).toBe(5);
  expect(w[WindowProp.YCursor]).toBe(1); // cursor was beyond the new bounds
  expect(w[WindowProp.XCursor]).toBe(1);
});

test("resizing a window that still contains its cursor leaves the cursor alone", () => {
  const s = new V6Screen();
  const w = s.windows[3];
  w[WindowProp.YCursor] = 2;
  w[WindowProp.XCursor] = 2;

  s.windowSize(3, 50, 50);

  expect(w[WindowProp.YCursor]).toBe(2);
  expect(w[WindowProp.XCursor]).toBe(2);
});
