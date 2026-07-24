export const TextStyle = {
  Roman: 0,
  Reverse: 1,
  Bold: 2,
  Italic: 4,
  FixedPitch: 8,
} as const;

export const DEFAULT_COLOR = 1;

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
}

export class Screen {
  readonly width: number;
  style: number = TextStyle.Roman;
  upper: Cell[][] = [];
  upperHeight = 0;
  cursorRow = 0;
  cursorCol = 0;
  currentWindow = 0;

  /** Sink for lower-window (main transcript) text. */
  onLowerOutput: (text: string, attrs: OutputAttrs) => void = () => {};

  /** Called when the lower window should be cleared. */
  onClearLower: () => void = () => {};

  constructor(width: number) {
    this.width = Math.max(1, width);
  }

  /** Split off `lines` rows for the upper window. v3 clears the upper window. */
  splitWindow(lines: number, clear: boolean): void {
    const previous = this.upper;

    lines = Math.max(0, Math.min(lines, 255));

    this.upper = Array.from({ length: lines }, (_, r) =>
      !clear && previous[r] ? previous[r] : this.blankRow(),
    );

    this.upperHeight = lines;

    if (this.cursorRow >= lines) {
      this.cursorRow = 0;
      this.cursorCol = 0;
    }
  }

  setWindow(window: number): void {
    this.currentWindow = window;

    // Selecting the upper window homes the cursor to the top-left.
    if (window === 1) {
      this.cursorRow = 0;
      this.cursorCol = 0;
    }
  }

  /** Position the upper-window cursor (0-based). */
  setCursor(row: number, col: number): void {
    this.cursorRow = row;
    this.cursorCol = col;
  }

  /**
   * Route printed text to the current window. Window 0 (lower) is the scrolling
   * transcript; window 1 (upper) is the fixed status region, whose characters
   * are stamped into the cell grid at the cursor. The upper window does not
   * scroll, so a newline or running past the right edge simply stops the write.
   */
  print(text: string): void {
    if (this.currentWindow === 0) {
      this.onLowerOutput(text, {
        style: this.style,
        foreground: DEFAULT_COLOR,
        background: DEFAULT_COLOR,
      });
      return;
    }

    if (this.cursorRow >= this.upper.length) return;

    const row = this.upper[this.cursorRow];

    for (const ch of text) {
      if (ch === "\n" || this.cursorCol >= this.width) break;
      row[this.cursorCol] = { ch, style: this.style, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR };
      this.cursorCol++;
    }
  }

  eraseWindow(window: number): void {
    if (window === -1) {
      // unsplit and clear everything
      this.upperHeight = 0;
      this.upper = [];
      this.cursorRow = 0;
      this.cursorCol = 0;
      this.onClearLower();
    } else if (window === -2) {
      this.upper = this.upper.map(() => this.blankRow());
      this.onClearLower();
    } else if (window === 1) {
      this.upper = this.upper.map(() => this.blankRow());
    } else if (window === 0) {
      this.onClearLower();
    }
  }

  /** The upper window's rows as plain strings (one per row), for a host to render. */
  upperRows(): string[] {
    return this.upper.map((row) => row.map((c) => c.ch).join(""));
  }

  private blankRow(): Cell[] {
    return Array.from({ length: this.width }, () => ({
      ch: " ",
      style: 0,
      fg: DEFAULT_COLOR,
      bg: DEFAULT_COLOR,
    }));
  }
}
