// Font 3, the Z-Machine "character graphics" font (Standard 1.1 §16). It is an
// 8x8 bitmap font of box-drawing pieces, arrows, and compass/map glyphs that
// games (notably Beyond Zork) switch to with set_font 3. Text hosts can't show
// the bitmaps, so we map each code to the closest Unicode glyph.
//
// The mappings were verified by position against Beyond Zork's on-screen layout
// (its ZIL constant names are noted alongside each code). The box frame and
// arrows are exact; the compass-rose pieces are sub-cell pixel shapes with no
// clean Unicode equivalent, so those are best-effort block/quadrant
// approximations. Codes with no mapping fall back to the raw character.

const FONT3: Readonly<Record<number, string>> = {
  32: " ",

  // Room/window border — corners and edges (BZ: TLC/TRC/BLC/BRC, TOP/BOT/LSID/RSID)
  47: "┌", // TLC top-left corner
  48: "┐", // TRC top-right corner
  46: "└", // BLC bottom-left corner
  49: "┘", // BRC bottom-right corner
  39: "─", // TOP horizontal edge
  38: "─", // BOT horizontal edge
  41: "│", // RSID vertical edge (left border of the box)
  40: "│", // LSID vertical edge (right border of the box)

  // Title/menu box — a second corner + edge set (BZ: TRCORNER..REDGE, 71-78)
  74: "┌", // TLCORNER
  71: "┐", // TRCORNER
  73: "└", // BLCORNER
  72: "┘", // BRCORNER
  75: "─", // TOPEDGE
  76: "─", // BOTEDGE
  77: "│", // LEDGE
  78: "│", // REDGE

  // Solid blocks (BZ: SOLID, ISOLID) and diagonals/crosses (RDIAG/LDIAG/XCROSS/HVCROSS)
  37: "█", // SOLID
  54: "▓", // ISOLID (inverse/shaded solid)
  35: "╱", // RDIAG
  36: "╲", // LDIAG
  90: "╳", // XCROSS
  91: "┼", // HVCROSS

  // Compass-rose pieces (approximate: sub-cell pixel shapes → nearest block/quadrant)
  55: "▀", // top
  56: "▄", // bottom
  57: "▌", // left
  58: "▌", // left
  61: "▐", // right
  63: "▘", // upper-left
  65: "▖", // lower-left
  66: "▝", // upper-right
  68: "▙", // left + bottom

  // Arrows — menu hints (BZ: UARROW/DARROW/UDARROW and inverse IUARROW/IDARROW/IUDARROW)
  92: "↑",
  93: "↓",
  94: "↕",
  123: "↑",
  124: "↓",
  125: "↕",

  // Misc (BZ: SMBOX, QMARK/IQMARK)
  95: "▪",
  96: "?",
  126: "?",
};

/** Map a font-3 character code to its Unicode approximation (raw char if unmapped). */
export function font3Char(code: number): string {
  return FONT3[code] ?? String.fromCharCode(code);
}

/** Whether font 3 has a defined Unicode glyph for this code (vs. a raw fallback). */
export function hasFont3Glyph(code: number): boolean {
  return code in FONT3;
}
