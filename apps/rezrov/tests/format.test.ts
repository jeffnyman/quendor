import { expect, test } from "vite-plus/test";
import type { Cell } from "quendor";
import {
  attrCss,
  escapeHtml,
  hex,
  outputRunCss,
  renderUpperRow,
  resolveAttrs,
  signed,
  zColorCss,
} from "../web/format.ts";

test("hex pads to width with a 0x prefix", () => {
  expect(hex(0x4f05)).toBe("0x4f05");
  expect(hex(0)).toBe("0x0000");
  expect(hex(0xff, 2)).toBe("0xff");
});

test("signed interprets 16-bit values as two's complement", () => {
  expect(signed(0)).toBe(0);
  expect(signed(0x7fff)).toBe(32767);
  expect(signed(0x8000)).toBe(-32768);
  expect(signed(0xffff)).toBe(-1);
});

test("zColorCss maps known Z colours and returns null otherwise", () => {
  expect(zColorCss(2)).toBe("#000000");
  expect(zColorCss(9)).toBe("#ffffff");
  expect(zColorCss(1)).toBeNull(); // 1 = default
  expect(zColorCss(99)).toBeNull(); // unknown
});

test("escapeHtml escapes only &, <, >", () => {
  expect(escapeHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  expect(escapeHtml("plain")).toBe("plain");
  expect(escapeHtml(`"quotes" 'stay'`)).toBe(`"quotes" 'stay'`);
});

test("attrCss: a plain run emits only colours that resolve", () => {
  expect(attrCss(0, 1, 1)).toEqual([]); // default colours resolve to null
  expect(attrCss(0, 2, 9)).toEqual(["color:#000000", "background:#ffffff"]);
});

test("attrCss: reverse video swaps fg/bg with theme fallbacks", () => {
  expect(attrCss(1, 1, 1)).toEqual(["color:var(--bg)", "background:var(--fg)"]);
  expect(attrCss(1, 2, 9)).toEqual(["color:#ffffff", "background:#000000"]);
});

test("attrCss: bold and italic style bits", () => {
  expect(attrCss(2, 1, 1)).toEqual(["font-weight:700"]);
  expect(attrCss(4, 1, 1)).toEqual(["font-style:italic"]);
  expect(attrCss(6, 1, 1)).toEqual(["font-weight:700", "font-style:italic"]);
});

test("outputRunCss emits a colour only when it differs from the page", () => {
  expect(outputRunCss(0, 3, 4, 3, 4)).toEqual([]); // both match the page
  expect(outputRunCss(0, 2, 4, 3, 4)).toEqual(["color:#000000"]); // fg differs
  expect(outputRunCss(0, 3, 9, 3, 4)).toEqual(["background:#ffffff"]); // bg differs
});

test("outputRunCss reverse video swaps fg/bg regardless of the page", () => {
  expect(outputRunCss(1, 2, 9, 2, 9)).toEqual(["color:#ffffff", "background:#000000"]);
});

test("outputRunCss adds bold/italic style bits", () => {
  expect(outputRunCss(2, 3, 4, 3, 4)).toEqual(["font-weight:700"]);
  expect(outputRunCss(4, 3, 4, 3, 4)).toEqual(["font-style:italic"]);
});

test("resolveAttrs applies Z-Machine defaults when attrs is absent", () => {
  expect(resolveAttrs(undefined)).toEqual({ style: 0, fg: 1, bg: 1 });
  expect(resolveAttrs({ style: 2, foreground: 4, background: 6 })).toEqual({
    style: 2,
    fg: 4,
    bg: 6,
  });
});

const cell = (ch: string, style = 0, fg = 1, bg = 1, font = 1): Cell => ({
  ch,
  style,
  fg,
  bg,
  font,
});

test("renderUpperRow coalesces identical adjacent cells and escapes text", () => {
  const row = [cell("<"), cell("a"), cell("b")];
  expect(renderUpperRow(row)).toBe(`<div class="upperrow">&lt;ab</div>`);
});

test("renderUpperRow wraps a styled run in a span and splits on style change", () => {
  const row = [cell("a"), cell("b", 2), cell("c", 2)];
  expect(renderUpperRow(row)).toBe(
    `<div class="upperrow">a<span style="font-weight:700">bc</span></div>`,
  );
});

test("renderUpperRow maps font-3 codes to glyphs, breaking runs on a font change", () => {
  // both cells are ']' (code 93) with identical style/colour, differing only in
  // font: font 3 -> ↓ glyph, font 1 -> raw ']'. If runs didn't break on font,
  // the second ']' would map too and give "↓↓".
  const row = [cell("]", 0, 1, 1, 3), cell("]", 0, 1, 1, 1)];
  expect(renderUpperRow(row)).toBe(`<div class="upperrow">↓]</div>`);
});

test("renderUpperRow of an empty row is just the wrapper", () => {
  expect(renderUpperRow([])).toBe(`<div class="upperrow"></div>`);
});
