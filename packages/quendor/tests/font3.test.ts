import { expect, test } from "vite-plus/test";
import { font3Char, hasFont3Glyph } from "../src/font3.ts";

test("maps the menu arrows to Unicode glyphs", () => {
  expect(font3Char(92)).toBe("↑"); // UARROW
  expect(font3Char(93)).toBe("↓"); // DARROW
  expect(font3Char(94)).toBe("↕"); // UDARROW
  expect(font3Char(123)).toBe("↑"); // inverse up arrow reuses the glyph
});

test("maps the box frame corners and edges", () => {
  expect(font3Char(74)).toBe("┌"); // TLCORNER
  expect(font3Char(71)).toBe("┐"); // TRCORNER
  expect(font3Char(73)).toBe("└"); // BLCORNER
  expect(font3Char(72)).toBe("┘"); // BRCORNER
  expect(font3Char(75)).toBe("─"); // TOPEDGE
  expect(font3Char(77)).toBe("│"); // LEDGE
});

test("falls back to the raw character for codes with no font-3 glyph", () => {
  expect(font3Char(65)).toBe("A"); // no glyph defined for 65
  expect(hasFont3Glyph(65)).toBe(false);
  expect(hasFont3Glyph(92)).toBe(true);
});
