import { expect, test } from "vite-plus/test";
import type { Cell } from "quendor";
import { attrCss, escapeHtml, renderRow, zColorCss } from "../web/format.ts";

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

const cell = (ch: string, style = 0, fg = 1, bg = 1): Cell => ({ ch, style, fg, bg });

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
