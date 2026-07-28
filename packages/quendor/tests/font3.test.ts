import { expect, test } from "vite-plus/test";
import { font3Char, hasFont3Glyph } from "../src/font3.ts";

test("maps the menu arrows to Unicode glyphs", () => {
  expect(font3Char(92)).toBe("↑"); // UARROW
  expect(font3Char(93)).toBe("↓"); // DARROW
  expect(font3Char(94)).toBe("↕"); // UDARROW
  expect(font3Char(123)).toBe("↑"); // inverse up arrow reuses the glyph
});

test("maps the title/menu box frame corners and edges (71-78)", () => {
  expect(font3Char(74)).toBe("┌"); // TLCORNER
  expect(font3Char(71)).toBe("┐"); // TRCORNER
  expect(font3Char(73)).toBe("└"); // BLCORNER
  expect(font3Char(72)).toBe("┘"); // BRCORNER
  expect(font3Char(75)).toBe("─"); // TOPEDGE
  expect(font3Char(77)).toBe("│"); // LEDGE
});

test("maps the room/window box frame corners and edges (38-49)", () => {
  expect(font3Char(47)).toBe("┌"); // TLC top-left
  expect(font3Char(48)).toBe("┐"); // TRC top-right
  expect(font3Char(46)).toBe("└"); // BLC bottom-left
  expect(font3Char(49)).toBe("┘"); // BRC bottom-right
  expect(font3Char(39)).toBe("─"); // TOP edge
  expect(font3Char(38)).toBe("─"); // BOT edge
  expect(font3Char(40)).toBe("│"); // LSID edge
  expect(font3Char(41)).toBe("│"); // RSID edge
});

test("falls back to the raw character for codes with no font-3 glyph", () => {
  expect(font3Char(100)).toBe("d"); // no glyph defined for 100
  expect(hasFont3Glyph(100)).toBe(false);
  expect(hasFont3Glyph(92)).toBe(true);
});
