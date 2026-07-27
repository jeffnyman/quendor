import { expect, test } from "vite-plus/test";
import type { Cell } from "quendor";
import {
  attrCss,
  escapeHtml,
  renderCells,
  renderInputRow,
  renderRow,
  renderRows,
  renderScreenHtml,
  zColorCss,
} from "../web/format.ts";

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

const cell = (ch: string, style = 0, fg = 1, bg = 1, font = 1): Cell => ({
  ch,
  style,
  fg,
  bg,
  font,
});

test("renderCells returns inner HTML with no row wrapper (for composing the input row)", () => {
  expect(renderCells([cell("<"), cell("a"), cell("b")])).toBe("&lt;ab");
  expect(renderCells([])).toBe("");
});

test("renderRow coalesces identical adjacent cells and escapes text", () => {
  const row = [cell("<"), cell("a"), cell("b")];
  expect(renderRow(row)).toBe(`<div class="row">&lt;ab</div>`);
});

test("renderRow wraps a styled run in a span and splits on style change", () => {
  const row = [cell("a"), cell("b", 2), cell("c", 2)];
  expect(renderRow(row)).toBe(`<div class="row">a<span style="font-weight:700">bc</span></div>`);
});

test("renderRow of an empty row is just the wrapper", () => {
  expect(renderRow([])).toBe(`<div class="row"></div>`);
});

test("renderCells wraps a font-3 run in a .font3 span (raw char) and breaks on font change", () => {
  // both cells are ']' (code 93); only the font differs. The font-3 cell keeps
  // its raw char in a .font3 span (FreeFont3 draws the glyph); the font-1 cell
  // renders as a plain ']'. If runs didn't break on font, they'd be one span.
  const row = [cell("]", 0, 1, 1, 3), cell("]", 0, 1, 1, 1)];
  expect(renderCells(row)).toBe(`<span class="font3">]</span>]`);
});

test("renderInputRow draws game cells, then the typed line with a caret", () => {
  const row = [cell(">"), cell(" ")]; // a "> " prompt; cursor at col 2
  expect(renderInputRow(row, 2, "go", 2)).toBe(
    `<div class="row">&gt; go<span class="caret"> </span></div>`,
  );
});

test("renderInputRow puts the caret on the character it sits on", () => {
  expect(renderInputRow([cell(">")], 1, "abc", 1)).toBe(
    `<div class="row">&gt;a<span class="caret">b</span>c</div>`,
  );
});

test("renderRows overlays the input only on the cursor row", () => {
  const grid = [[cell("a")], [cell("b")]];
  const overlay = { row: 1, col: 1, value: "", caret: 0 };
  expect(renderRows(grid, 0, overlay)).toEqual([
    `<div class="row">a</div>`,
    `<div class="row">b<span class="caret"> </span></div>`,
  ]);
});

test("renderRows with no overlay renders plain rows", () => {
  expect(renderRows([[cell("x")]], 0, null)).toEqual([`<div class="row">x</div>`]);
});

test("renderScreenHtml composes status bar (over row 0), grid rows, and [More]", () => {
  const grid = [[cell("A")], [cell("B")]];
  expect(renderScreenHtml(grid, "S", null, true)).toBe(
    `<div class="statusbar">S</div><div class="row">B</div>` +
      `<div class="more">— more — (press any key)</div>`,
  );
});

test("renderScreenHtml without a status line renders every row from the top", () => {
  expect(renderScreenHtml([[cell("A")]], null, null, false)).toBe(`<div class="row">A</div>`);
});
