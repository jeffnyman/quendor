import type { Cell, OutputAttrs } from "quendor";

// Pure formatting helpers: value → string/CSS. No DOM access, so these are
// unit-testable in isolation (and keep the DOM render functions thin).

/** Hex with a leading `0x`, zero-padded to `w` digits (default 4). */
export const hex = (n: number, w = 4): string => "0x" + n.toString(16).padStart(w, "0");

/** Interpret a 16-bit value as signed. */
export const signed = (v: number): number => (v >= 0x8000 ? v - 0x10000 : v);

/** Z-Machine colour number → CSS colour (null = default/inherit). */
export function zColorCss(n: number): string | null {
  return (
    {
      2: "#000000",
      3: "#e05a5a",
      4: "#3fb950",
      5: "#e3d34a",
      6: "#5a8ce0",
      7: "#c678dd",
      8: "#4ac3d3",
      9: "#ffffff",
      10: "#bbbbbb",
      11: "#888888",
      12: "#555555",
    }[n] ?? null
  );
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** Build the inline CSS for an upper-window run given style bits and colours. */
export function attrCss(style: number, fg: number, bg: number): string[] {
  const fgc = zColorCss(fg);
  const bgc = zColorCss(bg);
  const css: string[] = [];

  if (style & 1) {
    // reverse video: swap fg/bg (falling back to the theme colours)
    css.push(`color:${bgc ?? "var(--bg)"}`, `background:${fgc ?? "var(--fg)"}`);
  } else {
    if (fgc) css.push(`color:${fgc}`);
    if (bgc) css.push(`background:${bgc}`);
  }

  if (style & 2) css.push("font-weight:700");
  if (style & 4) css.push("font-style:italic");

  return css;
}

/**
 * Inline CSS for a lower-window (transcript) output run, given the current page
 * colours. Only what differs from the page is styled: reverse video swaps fg/bg,
 * and a colour is emitted only when it isn't already the page colour.
 */
export function outputRunCss(
  style: number,
  fg: number,
  bg: number,
  termFg: number,
  termBg: number,
): string[] {
  const css: string[] = [];

  if ((style & 1) !== 0) {
    css.push(`color:${zColorCss(bg) ?? "var(--bg)"}`, `background:${zColorCss(fg) ?? "var(--fg)"}`);
  } else {
    if (fg !== termFg && zColorCss(fg)) css.push(`color:${zColorCss(fg)}`);
    if (bg !== termBg && zColorCss(bg)) css.push(`background:${zColorCss(bg)}`);
  }

  if (style & 2) css.push("font-weight:700");
  if (style & 4) css.push("font-style:italic");

  return css;
}

/** Resolve OutputAttrs with Z-Machine defaults (style 0, colours 1) for a run. */
export function resolveAttrs(attrs?: OutputAttrs): { style: number; fg: number; bg: number } {
  return {
    style: attrs?.style ?? 0,
    fg: attrs?.foreground ?? 1,
    bg: attrs?.background ?? 1,
  };
}

/** Render one upper-window row to HTML, coalescing runs of identical style. */
export function renderUpperRow(row: Cell[]): string {
  let html = "";
  let i = 0;

  while (i < row.length) {
    const { style, fg, bg } = row[i];
    let text = "";
    while (i < row.length && row[i].style === style && row[i].fg === fg && row[i].bg === bg) {
      text += row[i].ch;
      i++;
    }

    const escaped = escapeHtml(text);
    const css = attrCss(style, fg, bg);

    html += css.length === 0 ? escaped : `<span style="${css.join(";")}">${escaped}</span>`;
  }

  return `<div class="upperrow">${html}</div>`;
}
