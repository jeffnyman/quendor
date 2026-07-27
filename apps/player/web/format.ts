import type { Cell } from "quendor";

// Grid-render helpers for the player: a screen cell grid → HTML. These mirror
// the same-named helpers in rezrov; once the player settles they're the obvious
// candidate to extract into a shared web-runtime module both apps consume.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

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

/** Build the inline CSS for a grid run given style bits and colours. */
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

/** Render a run of cells to inner HTML, coalescing runs of identical style. */
export function renderCells(row: Cell[]): string {
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

  return html;
}

/** Render one full screen row as a `<div class="row">`. */
export function renderRow(row: Cell[]): string {
  return `<div class="row">${renderCells(row)}</div>`;
}
