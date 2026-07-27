// Font 3, the Z-Machine "character graphics" font (Standard 1.1 §16). It is an
// 8x8 bitmap font of box-drawing pieces, arrows, and map connectors that games
// (notably Beyond Zork) switch to with set_font 3. Text hosts can't show the
// bitmaps, so we map each code to the closest Unicode glyph; the mapping below
// covers the glyphs Beyond Zork actually uses (its own names, from the game's
// ZIL constants, are noted alongside each code). Codes with no good Unicode
// match fall back to the raw character.

const FONT3: Readonly<Record<number, string>> = {
  32: " ",

  // Box frame — corners and edges (BZ: TRCORNER..REDGE, 71-78)
  71: "┐", // ┐ top-right corner
  72: "┘", // ┘ bottom-right corner
  73: "└", // └ bottom-left corner
  74: "┌", // ┌ top-left corner
  75: "─", // ─ top edge
  76: "─", // ─ bottom edge
  77: "│", // │ left edge
  78: "│", // │ right edge

  // Solid / half blocks (BZ: SOLID, BOT, TOP, LSID, RSID, ISOLID)
  37: "█", // █ solid
  38: "▄", // ▄ bottom half
  39: "▀", // ▀ top half
  40: "▌", // ▌ left half
  41: "▐", // ▐ right half
  54: "█", // █ inverse solid

  // Diagonals and crosses (BZ: RDIAG, LDIAG, XCROSS, HVCROSS)
  35: "╱", // ╱ right diagonal
  36: "╲", // ╲ left diagonal
  90: "╳", // ╳ diagonal cross
  91: "┼", // ┼ line cross

  // Arrows — the menu's "use ↑/↓" hints (BZ: UARROW/DARROW/UDARROW and the
  // inverse-video IUARROW/IDARROW/IUDARROW, which reuse the same glyph).
  92: "↑", // ↑ up
  93: "↓", // ↓ down
  94: "↕", // ↕ up-down
  123: "↑", // ↑ up (inverse)
  124: "↓", // ↓ down (inverse)
  125: "↕", // ↕ up-down (inverse)

  // Misc (BZ: SMBOX, QMARK/IQMARK)
  95: "▪", // ▪ small box
  96: "?", // question mark
  126: "?", // question mark (inverse)
};

/** Map a font-3 character code to its Unicode approximation (raw char if unmapped). */
export function font3Char(code: number): string {
  return FONT3[code] ?? String.fromCharCode(code);
}

/** Whether font 3 has a defined Unicode glyph for this code (vs. a raw fallback). */
export function hasFont3Glyph(code: number): boolean {
  return code in FONT3;
}
