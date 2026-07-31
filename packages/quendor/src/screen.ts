export const TextStyle = {
  Roman: 0,
  Reverse: 1,
  Bold: 2,
  Italic: 4,
  FixedPitch: 8,
} as const;

export const DEFAULT_COLOR = 1;
const DEFAULT_FONT = 1;
const DEFAULT_HEIGHT = 25;

/** Attributes attached to lower-window (transcript) output. */
export interface OutputAttrs {
  style: number;
  foreground: number;
  background: number;
}

export interface Cell {
  ch: string;
  style: number;
  /** Z-Machine color numbers (1 = default; 2..12 specific). */
  fg: number;
  bg: number;
  /** Z-Machine font number (1 = normal, 3 = character graphics, 4 = fixed-pitch). */
  font: number;
}

/**
 * The Z-Machine screen (V3-V5) as a single persistent character grid. The two
 * "windows" are row-range views into it: the upper window is rows [0, upperHeight)
 * and never scrolls; the lower window is the rest and scrolls within its own
 * region. Content printed to the grid stays until overwritten or scrolled off —
 * which is what lets a game draw in a tall upper window, shrink it, and keep the
 * drawing as a backdrop (Std §8.7.2.1). See docs/screen-model.md.
 *
 * The lower window is *also* streamed verbatim to `onLowerOutput` (the transcript),
 * independent of the grid: the grid is the display, the stream is the printed-text
 * history. Hosts render the grid; acceptance/transcripts read the stream.
 */
export class Screen {
  readonly width: number;
  readonly height: number;
  style: number = TextStyle.Roman;
  foreground: number = DEFAULT_COLOR;
  background: number = DEFAULT_COLOR;
  font: number = DEFAULT_FONT;

  /** The whole screen; windows are row-range views into this. */
  grid: Cell[][];
  upperHeight = 0;
  currentWindow = 0;

  /** Upper-window cursor (0-based, within the upper window). */
  cursorRow = 0;
  cursorCol = 0;

  /** Lower-window cursor (0-based, absolute grid coordinates). */
  private lowerRow = 0;
  private lowerCol = 0;

  /** Lower-window lines scrolled since the last input; drives the `[More]` prompt. */
  linesSinceInput = 0;

  /** The v3 status bar text, or null when not applicable / not yet drawn. */
  statusLine: string | null = null;

  /** Sink for lower-window (main transcript) text. */
  onLowerOutput: (text: string, attrs: OutputAttrs) => void = () => {};

  /** Called when the lower window should be cleared. */
  onClearLower: () => void = () => {};

  /**
   * Called when the upper window changes structurally (split/set_window/erase),
   * letting a host repaint it right away rather than only at the next input
   * prompt — needed to catch transient content such as a quote box.
   */
  onUpperUpdate: () => void = () => {};

  /**
   * Fired when a screenful of lower-window text has scrolled by without input.
   * The interactive host pauses with a `[More]` prompt; a scripted run leaves this
   * a no-op so it never blocks. Display chrome only — never reaches `onLowerOutput`.
   */
  onMore: () => void = () => {};

  constructor(width: number, height: number = DEFAULT_HEIGHT) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.grid = this.blankGrid();
  }

  /** The upper window's rows: a view over the top `upperHeight` grid rows. */
  get upper(): Cell[][] {
    return this.grid.slice(0, this.upperHeight);
  }

  /** The lower window's cursor (absolute grid coordinates) — where input is echoed. */
  get lowerCursor(): { row: number; col: number } {
    return { row: this.lowerRow, col: this.lowerCol };
  }

  /** Compose the v3 status bar: location on the left, score/time on the right. */
  setStatusLine(left: string, right: string): void {
    const w = this.width;
    let line = " " + left;

    if (line.length + right.length + 1 <= w) {
      line = line.padEnd(w - right.length - 1) + right + " ";
    } else {
      line = (line + " " + right).slice(0, w);
    }

    this.statusLine = line.slice(0, w);
  }

  /**
   * Set the upper window to `lines` rows. v3 clears the new upper region; v4/5
   * leaves the grid untouched (§8.7.2), so a shrink keeps whatever was drawn.
   * A split that would swallow the lower cursor pushes it down (§8.7.2.2).
   */
  splitWindow(lines: number, clear: boolean): void {
    this.upperHeight = Math.max(0, Math.min(lines, this.height));

    if (clear) this.blankRows(0, this.upperHeight);

    // Home the upper cursor if it now sits outside the upper window.
    if (this.cursorRow >= this.upperHeight) {
      this.cursorRow = 0;
      this.cursorCol = 0;
    }

    // The lower window can't start underneath the upper one (§8.7.2.2).
    if (this.lowerRow < this.upperHeight) {
      this.lowerRow = this.upperHeight;
      this.lowerCol = 0;
    }

    this.onUpperUpdate();
  }

  setWindow(window: number): void {
    this.currentWindow = window;

    // Selecting the upper window homes its cursor to the top-left (§8.7.2).
    if (window === 1) {
      this.cursorRow = 0;
      this.cursorCol = 0;
    }

    this.onUpperUpdate();
  }

  /** Position the upper-window cursor (0-based). */
  setCursor(row: number, col: number): void {
    this.cursorRow = row;
    this.cursorCol = col;
  }

  /** set_color: 0 = leave unchanged ("current"), otherwise set. */
  setColor(foreground: number, background: number): void {
    if (foreground !== 0) this.foreground = foreground;
    if (background !== 0) this.background = background;
  }

  /**
   * set_font: switch the current font, returning the previous one (0 = the
   * requested font is unavailable). The grid is inherently monospace, so normal
   * (1), character graphics (3), and fixed-pitch (4) are all available; the font
   * is stamped into each printed cell so hosts can map font 3 to its glyphs.
   */
  setFont(font: number): number {
    if (font !== 1 && font !== 3 && font !== 4) return 0;

    const previous = this.font;
    this.font = font;
    return previous;
  }

  /**
   * Route printed text to the current window. The lower window (0) is the
   * scrolling transcript: text is streamed to `onLowerOutput` and laid onto the
   * grid, wrapping and scrolling its region. The upper window (1) overlays
   * characters into the cell grid at the cursor and never scrolls, so a newline
   * or running past the right edge simply stops the write (§8.7.3.1).
   */
  print(text: string): void {
    if (this.currentWindow === 0) {
      this.printLower(text);
      return;
    }

    if (this.cursorRow >= this.upperHeight) return;

    const row = this.grid[this.cursorRow];

    for (const ch of text) {
      if (ch === "\n" || this.cursorCol >= this.width) break;
      row[this.cursorCol] = this.cell(ch);
      this.cursorCol++;
    }
  }

  /** Reset the paging counter: the player has caught up (after input or `[More]`). */
  resetPaging(): void {
    this.linesSinceInput = 0;
  }

  reset(): void {
    this.grid = this.blankGrid();
    this.upperHeight = 0;
    this.currentWindow = 0;
    this.style = TextStyle.Roman;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.lowerRow = 0;
    this.lowerCol = 0;
    this.linesSinceInput = 0;
    this.foreground = DEFAULT_COLOR;
    this.background = DEFAULT_COLOR;
    this.font = DEFAULT_FONT;
    this.statusLine = null;
  }

  eraseWindow(window: number): void {
    if (window === -1) {
      // Clear the whole screen and unsplit (§8.7.3.3).
      this.blankRows(0, this.height);
      this.upperHeight = 0;
      this.cursorRow = 0;
      this.cursorCol = 0;
      this.lowerRow = 0;
      this.lowerCol = 0;
      this.currentWindow = 0;
      this.onClearLower();
    } else if (window === -2) {
      // Clear both regions but keep the split.
      this.blankRows(0, this.height);
      this.cursorRow = 0;
      this.cursorCol = 0;
      this.lowerRow = this.upperHeight;
      this.lowerCol = 0;
      this.onClearLower();
    } else if (window === 1) {
      this.blankRows(0, this.upperHeight);
      this.cursorRow = 0;
      this.cursorCol = 0;
    } else if (window === 0) {
      this.blankRows(this.upperHeight, this.height);
      this.lowerRow = this.upperHeight;
      this.lowerCol = 0;
      this.onClearLower();
    }

    this.onUpperUpdate();
  }

  /** The upper window's rows as plain strings (one per row), for a host to render. */
  upperRows(): string[] {
    return this.upper.map((row) => row.map((c) => c.ch).join(""));
  }

  // --- lower-window text flow ------------------------------------------------

  private printLower(text: string): void {
    this.onLowerOutput(text, {
      style: this.style,
      foreground: this.foreground,
      background: this.background,
    });

    for (const ch of text) {
      if (ch === "\n") {
        this.lowerNewline();
      } else {
        if (this.lowerCol >= this.width) this.lowerNewline();
        this.grid[this.lowerRow][this.lowerCol] = this.cell(ch);
        this.lowerCol++;
      }
    }
  }

  private lowerNewline(): void {
    this.lowerCol = 0;
    this.lowerRow++;

    if (this.lowerRow >= this.height) {
      this.scrollLower();
      this.lowerRow = this.height - 1;
    }
  }

  /** Scroll the lower region up one line, and page when a screenful has passed. */
  private scrollLower(): void {
    for (let r = this.upperHeight; r < this.height - 1; r++) {
      this.grid[r] = this.grid[r + 1];
    }
    this.grid[this.height - 1] = this.blankRow();

    const lowerHeight = this.height - this.upperHeight;
    this.linesSinceInput++;

    if (this.linesSinceInput >= lowerHeight - 1) {
      this.linesSinceInput = 0;
      this.onMore();
    }
  }

  // --- grid helpers ----------------------------------------------------------

  private cell(ch: string): Cell {
    return { ch, style: this.style, fg: this.foreground, bg: this.background, font: this.font };
  }

  private blankRow(): Cell[] {
    return Array.from({ length: this.width }, () => ({
      ch: " ",
      style: 0,
      fg: DEFAULT_COLOR,
      bg: this.background,
      font: DEFAULT_FONT,
    }));
  }

  private blankGrid(): Cell[][] {
    return Array.from({ length: this.height }, () => this.blankRow());
  }

  /** Blank grid rows in the half-open range [start, end). */
  private blankRows(start: number, end: number): void {
    for (let r = start; r < end; r++) this.grid[r] = this.blankRow();
  }
}
