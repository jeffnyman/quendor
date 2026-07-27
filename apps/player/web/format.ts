import { font3Char } from "quendor";
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
    const { style, fg, bg, font } = row[i];
    let text = "";
    while (
      i < row.length &&
      row[i].style === style &&
      row[i].fg === fg &&
      row[i].bg === bg &&
      row[i].font === font
    ) {
      // Font 3 is the character-graphics font: map its codes to Unicode glyphs.
      text += font === 3 ? font3Char(row[i].ch.charCodeAt(0)) : row[i].ch;
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

/** The in-progress input line to overlay on the cursor row during a line read. */
export interface InputOverlay {
  row: number;
  col: number;
  value: string;
  caret: number;
}

/**
 * Render the cursor row with the in-progress input overlaid: the game's cells up
 * to the cursor column, then the typed text with a caret drawn where the game
 * actually left the cursor. This is why the player has no input box — you type
 * at the prompt, exactly as a real interpreter echoes input.
 */
export function renderInputRow(row: Cell[], col: number, value: string, caret: number): string {
  const before = renderCells(row.slice(0, col));
  const pre = escapeHtml(value.slice(0, caret));
  const at = escapeHtml(value.slice(caret, caret + 1) || " "); // caret sits on a char or a blank
  const post = escapeHtml(value.slice(caret + 1));

  return `<div class="row">${before}${pre}<span class="caret">${at}</span>${post}</div>`;
}

/** Render every grid row from `start`, overlaying the input line on its cursor row. */
export function renderRows(grid: Cell[][], start: number, overlay: InputOverlay | null): string[] {
  const rows: string[] = [];

  for (let r = start; r < grid.length; r++) {
    if (overlay && r === overlay.row) {
      rows.push(renderInputRow(grid[r], overlay.col, overlay.value, overlay.caret));
    } else {
      rows.push(renderRow(grid[r]));
    }
  }

  return rows;
}

/**
 * Compose the whole screen to HTML: the v3 status line as a bar over row 0, the
 * grid rows (with the input overlay on the cursor row), and a [More] prompt.
 */
export function renderScreenHtml(
  grid: Cell[][],
  statusLine: string | null,
  overlay: InputOverlay | null,
  showMore: boolean,
): string {
  const rows: string[] = [];

  if (statusLine) rows.push(`<div class="statusbar">${escapeHtml(statusLine)}</div>`);
  rows.push(...renderRows(grid, statusLine ? 1 : 0, overlay));
  if (showMore) rows.push(`<div class="more">— more — (press any key)</div>`);

  return rows.join("");
}
