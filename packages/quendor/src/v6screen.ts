import type { OutputAttrs } from "./screen.ts";
import { DEFAULT_COLOR } from "./screen.ts";

const PROP_COUNT = 18;

// Window attribute bits (WINATTR).
const ATTR_WRAP = 1;
const ATTR_SCROLL = 2;
const ATTR_TRANSCRIPT = 4;
const ATTR_BUFFER = 8;

/** A run of text placed at an absolute (0-based) pixel position on the screen. */
export interface TextSpan {
  x: number;
  y: number;
  text: string;
  style: number;
  fg: number;
  bg: number;
}

export const WindowProp = {
  YPos: 0,
  XPos: 1,
  YSize: 2,
  XSize: 3,
  YCursor: 4,
  XCursor: 5,
  LeftMargin: 6,
  RightMargin: 7,
  NewlineRoutine: 8,
  InterruptCount: 9,
  Style: 10,
  Colour: 11,
  Font: 12,
  FontSize: 13,
  Attributes: 14,
  LineCount: 15,
  TrueForeground: 16,
  TrueBackground: 17,
} as const;

/**
 * A picture drawn into a window. Tracked here (not just in the renderer) so it
 * shares the window's scroll/clear model: a picture drawn inline in the main
 * reading window — Zork Zero's drop-cap letters and little scene vignettes —
 * scrolls up with the text it sits beside, exactly as the original does.
 */
export interface PictureOp {
  n: number;
  /** Absolute top-left pixel position (1-based, matching span coords). */
  x: number;
  y: number;
  /** Intrinsic pixel size, for scroll/clear bounds. */
  w: number;
  h: number;
  /** Index of the window it was drawn into (governs scroll/clear membership). */
  win: number;
}

export class V6Screen {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly fontW: number;
  readonly fontH: number;

  /** Font cell size in pixels, as (height << 8) | width. */
  readonly fontSize: number;

  /** Eight windows, each an 18-word property table. */
  readonly windows: number[][];

  /** Positioned text runs (absolute pixels), replayed by the renderer. */
  spans: TextSpan[] = [];

  /** Pictures drawn into windows, replayed by the renderer; scroll with text. */
  pictures: PictureOp[] = [];

  /** Per-window pending word buffer (word-wrap accumulates across print calls). */
  private pending: string[] = ["", "", "", "", "", "", "", ""];

  current = 0;

  // --- [More] pausing: when the scrolling window fills with unread text, pause
  //     so text isn't lost off the top. Since we can't block mid-instruction,
  //     the un-shown remainder is buffered and revealed on the next keypress.
  //     Opt-in: only a consumer that actually displays the fixed grid (the web
  //     player) enables it. Headless/CLI use the linear transcript mirror, which
  //     scrolls freely and gets all text, so [More] there would only stall.
  needsMore = false;
  moreEnabled = false;
  private moreCount = 0; // lines scrolled since the last input / [More]
  private moreBuffer = ""; // text not yet displayed (held behind the [More])

  /**
   * Mirror of the main window (0) output for the linear transcript sink
   * (headless/CLI/tests). Windows 1-7 are span-only.
   */
  onLowerText: (text: string, attrs: OutputAttrs) => void = () => {};

  constructor(widthPx = 320, heightPx = 200, fontW = 8, fontH = 8) {
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.fontW = Math.max(1, fontW);
    this.fontH = Math.max(1, fontH);
    this.fontSize = ((fontH & 0xff) << 8) | (fontW & 0xff);
    this.windows = Array.from({ length: 8 }, () => this.blankWindow());
    this.initWindows();
  }

  private blankWindow(): number[] {
    const w: number[] = Array.from({ length: PROP_COUNT }, () => 0);

    w[WindowProp.YPos] = 1;
    w[WindowProp.XPos] = 1;
    w[WindowProp.YCursor] = 1;
    w[WindowProp.XCursor] = 1;
    w[WindowProp.Font] = 1;
    w[WindowProp.FontSize] = this.fontSize;
    w[WindowProp.Colour] = (DEFAULT_COLOR << 8) | DEFAULT_COLOR; // (bg<<8)|fg
    w[WindowProp.Attributes] = ATTR_BUFFER; // buffering on initially (YZIP)

    return w;
  }

  private win(arg: number): number[] {
    const i = arg === -3 ? this.current : arg & 0x7;

    return this.windows[i] ?? this.windows[0];
  }

  private initWindows(): void {
    const w0 = this.windows[0];

    w0[WindowProp.YSize] = this.heightPx;
    w0[WindowProp.XSize] = this.widthPx;
    w0[WindowProp.Attributes] = ATTR_WRAP | ATTR_SCROLL | ATTR_TRANSCRIPT | ATTR_BUFFER;

    const w1 = this.windows[1];

    w1[WindowProp.XSize] = this.widthPx;
    w1[WindowProp.YSize] = 0;
  }

  windowSize(win: number, y: number, x: number): void {
    const w = this.win(win);
    w[WindowProp.YSize] = y & 0xffff;
    w[WindowProp.XSize] = x & 0xffff;

    if (w[WindowProp.YCursor] > y || w[WindowProp.XCursor] > x) {
      w[WindowProp.YCursor] = 1;
      w[WindowProp.XCursor] = 1;
    }
  }

  /**
   * Width of a character in pixels for a ~proportional font. The exact values
   * only need to be plausible and *consistent* between wrapping (here) and
   * rendering (which advances by the same table). Scaled to the font height.
   */
  charWidth(code: number): number {
    const ch = String.fromCharCode(code);
    let u: number; // width in units for an 8px font (tuned to match the games'

    if (ch === " ")
      u = 3; // tighter proportional font)
    else if ("il.,:;'!|".includes(ch)) u = 2;
    else if ('Ijft()[]{}"/\\-'.includes(ch)) u = 3;
    else if ("mwMW@".includes(ch)) u = 7;
    else if (ch >= "A" && ch <= "Z") u = 6;
    else u = 4; // lowercase, digits, most punctuation

    return Math.max(1, Math.round((u * this.fontH) / 8));
  }

  print(text: string): void {
    // Mirror the main window's prose to the linear transcript ONCE (it is not
    // subject to [More] — the CLI/web terminal scrolls freely).
    if (this.current === 0) {
      const w = this.windows[0];

      this.onLowerText(text, {
        style: w[WindowProp.Style],
        foreground: w[WindowProp.Colour] & 0xff || DEFAULT_COLOR,
        background: (w[WindowProp.Colour] >> 8) & 0xff || DEFAULT_COLOR,
      });
    }

    this.displayText(text);
  }

  textWidth(s: string): number {
    let w = 0;

    for (const c of s) {
      w += this.charWidth(c.charCodeAt(0));
    }

    return w;
  }

  picturePosition(y: number, x: number): [number, number] {
    const w = this.windows[this.current];
    const absY = (y === 0 ? w[WindowProp.YCursor] : y) + w[WindowProp.YPos] - 1;
    const absX = (x === 0 ? w[WindowProp.XCursor] : x) + w[WindowProp.XPos] - 1;

    return [absY, absX];
  }

  /**
   * Record a picture drawn at an absolute pixel position, tied to the current
   * window so it scrolls and clears with that window's text (see `PictureOp`).
   */
  addPicture(n: number, absY: number, absX: number, w: number, h: number): void {
    this.pictures.push({ n, x: absX, y: absY, w, h, win: this.current });
    if (this.pictures.length > 400) this.pictures.shift(); // bound long sessions
  }

  setMargins(win: number, left: number, right: number): void {
    const w = this.win(win);

    w[WindowProp.LeftMargin] = left & 0xffff;
    w[WindowProp.RightMargin] = right & 0xffff;
  }

  getProp(win: number, prop: number): number {
    if (prop < 0 || prop >= PROP_COUNT) return 0;

    return this.win(win)[prop] & 0xffff;
  }

  putProp(win: number, prop: number, value: number): void {
    if (prop < 0 || prop >= PROP_COUNT) return;

    this.win(win)[prop] = value & 0xffff;
  }

  moveWindow(win: number, y: number, x: number): void {
    const w = this.win(win);

    w[WindowProp.YPos] = y & 0xffff;
    w[WindowProp.XPos] = x & 0xffff;
  }

  /** Lay text into the display (spans), honouring [More] (buffering the rest). */
  private displayText(text: string): void {
    if (this.needsMore) {
      this.moreBuffer += text;
      return;
    }

    const w = this.windows[this.current];
    const wrap = (w[WindowProp.Attributes] & ATTR_WRAP) !== 0;
    // Split into code points. ZSCII output is one code point per character, so
    // this is exactly the granularity we lay out and buffer by (and it sidesteps
    // the string-spread footgun of splitting graphemes we never receive here).
    const chars = Array.from(text);

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];

      if (ch === "\r") continue;

      // Whether laying out this character filled a scrolling window and tripped a
      // [More] pause. flushWord/newline report this back rather than only setting
      // this.needsMore, so the "hold the rest" decision below is visibly driven by
      // what just happened (not a side effect the reader has to infer).
      let filled = false;

      if (ch === "\n") {
        const flushed = this.flushWord(this.current);

        filled = this.newline(w) || flushed;
      } else if (wrap) {
        if (ch === " ") {
          filled = this.flushWord(this.current);

          if (w[WindowProp.XCursor] > 1 + w[WindowProp.LeftMargin]) {
            w[WindowProp.XCursor] = w[WindowProp.XCursor] + this.charWidth(32);
          }
        } else {
          this.pending[this.current] += ch;
        }
      } else {
        this.placeChar(w, ch); // positioned window: place immediately
      }

      // A scroll may have filled the window — hold the rest behind a [More].
      if (filled) {
        this.moreBuffer += chars.slice(i + 1).join("");
        return;
      }
    }
  }

  /** Place a single character at the cursor (non-wrapping / positioned window). */
  private placeChar(w: number[], ch: string): void {
    if (ch !== " ") {
      this.emit(w, ch);
    }

    w[WindowProp.XCursor] = w[WindowProp.XCursor] + this.charWidth(ch.charCodeAt(0));
  }

  /**
   * Flush a wrapping window's pending word, wrapping to the next line if needed.
   * Returns true if that wrap tripped a [More] pause (propagated from newline).
   */
  private flushWord(wi: number): boolean {
    const word = this.pending[wi];

    if (!word) return false;

    this.pending[wi] = "";

    const w = this.windows[wi];
    const wordW = this.textWidth(word);
    const left = 1 + w[WindowProp.LeftMargin];
    const rightLimit = w[WindowProp.XSize] - w[WindowProp.RightMargin];
    let filled = false;

    if (w[WindowProp.XCursor] > left && w[WindowProp.XCursor] - 1 + wordW > rightLimit) {
      filled = this.newline(w);
    }

    this.emit(w, word);
    w[WindowProp.XCursor] = w[WindowProp.XCursor] + wordW;

    return filled;
  }

  /** Emit a span for `text` at the window's current cursor (absolute pixels). */
  private emit(w: number[], text: string): void {
    this.spans.push({
      x: w[WindowProp.XPos] - 1 + (w[WindowProp.XCursor] - 1),
      y: w[WindowProp.YPos] - 1 + (w[WindowProp.YCursor] - 1),
      text,
      style: w[WindowProp.Style],
      fg: w[WindowProp.Colour] & 0xff || DEFAULT_COLOR,
      bg: (w[WindowProp.Colour] >> 8) & 0xff || DEFAULT_COLOR,
    });

    if (this.spans.length > 4000) this.spans.shift(); // backstop for long sessions
  }

  /**
   * Advance to the next line, scrolling a full window. Returns true if this
   * line-break filled a scrolling window and tripped a [More] pause, so callers
   * can hold the remaining text back instead of losing it off the top.
   */
  private newline(w: number[]): boolean {
    w[WindowProp.YCursor] = w[WindowProp.YCursor] + this.fontH;
    w[WindowProp.XCursor] = 1 + w[WindowProp.LeftMargin];

    if (w[WindowProp.YCursor] - 1 + this.fontH > w[WindowProp.YSize]) {
      if (w[WindowProp.Attributes] & ATTR_SCROLL) {
        this.scroll(w);
        w[WindowProp.YCursor] = w[WindowProp.YSize] - this.fontH + 1;
      }
    }

    // Count lines printed to a scrolling window since the last read/[More]; pause
    // when it has filled the window so unread text isn't scrolled away.
    if (this.moreEnabled && w[WindowProp.Attributes] & ATTR_SCROLL) {
      if (++this.moreCount >= this.moreLimit(w)) {
        this.needsMore = true;

        return true;
      }
    }

    return false;
  }

  private moreLimit(w: number[]): number {
    return Math.max(1, Math.floor(w[WindowProp.YSize] / this.fontH) - 1);
  }

  /**
   * Scroll a window's spans (and its pictures) up by one line, dropping those
   * that pass above its top.
   */
  private scroll(w: number[]): void {
    const [top, left, bottom, right] = this.regionOf(w);
    const kept: TextSpan[] = [];
    for (const s of this.spans) {
      if (s.y >= top && s.y < bottom && s.x >= left && s.x < right) {
        const ny = s.y - this.fontH;
        if (ny >= top) kept.push({ ...s, y: ny });
        // else: scrolled off the top — dropped
      } else {
        kept.push(s);
      }
    }
    this.spans = kept;

    // Pictures drawn into this window scroll with it (inline drop-caps/vignettes),
    // dropping once fully above the top. Membership is by window index, not
    // position, so a picture that has scrolled partly above top still moves.
    const wi = this.windows.indexOf(w);
    const keptPics: PictureOp[] = [];

    for (const p of this.pictures) {
      if (p.win === wi) {
        const ny = p.y - this.fontH;

        if (ny + p.h > top) keptPics.push({ ...p, y: ny }); // still partly visible
        // else: scrolled off the top — dropped
      } else {
        keptPics.push(p);
      }
    }

    this.pictures = keptPics;
  }

  /** Absolute pixel region [top, left, bottom, right) of a window. */
  private regionOf(w: number[]): [number, number, number, number] {
    const top = w[WindowProp.YPos] - 1;
    const left = w[WindowProp.XPos] - 1;

    return [top, left, top + w[WindowProp.YSize], left + w[WindowProp.XSize]];
  }
}
