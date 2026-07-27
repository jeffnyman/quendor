/**
 * Node-only stdin helper, shared by the `quendor` player and the `zexp`
 * debugger CLIs. Lives here (not in the pure engine) because it needs
 * `node:fs`; exposed through `quendor/node`.
 */

import { readSync } from "node:fs";

/**
 * Read one byte from stdin (fd 0) synchronously, retrying on EAGAIN (a
 * non-blocking stdin under some shells). Returns the decoded character, or null
 * at end of input / on a closed stream. The synchronous read fits the tight run
 * loop, where the machine blocks on input between instructions.
 */
function readByteSync(): string | null {
  const buf = Buffer.alloc(1);

  for (;;) {
    let n: number;

    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
      return null; // EOF or closed stream
    }

    if (n === 0) return null; // EOF

    return buf.toString("utf8");
  }
}

/**
 * Read one line from stdin synchronously. Returns the line without its trailing
 * newline, or null at end of input.
 */
export function readLineSync(): string | null {
  let line = "";
  let sawAny = false;

  for (;;) {
    const ch = readByteSync();

    if (ch === null) break; // EOF or closed stream

    sawAny = true;

    if (ch === "\n") return line;
    if (ch !== "\r") line += ch;
  }

  return sawAny ? line : null;
}

/**
 * Read a single keystroke synchronously in raw mode, so no Enter is needed
 * (for read_char / "press any key"). Returns the character, or null at end of
 * input. Restores the terminal's cooked mode afterward.
 */
export function readCharSync(): string | null {
  const stdin = process.stdin;

  if (stdin.isTTY) stdin.setRawMode(true);

  const ch = readByteSync();

  if (stdin.isTTY) stdin.setRawMode(false);

  return ch;
}

/**
 * Read a keystroke for read_char, decoding terminal arrow-key escape sequences
 * (`ESC [ A/B/C/D` or the SS3 `ESC O ...` form) to their ZSCII codes 129-132, so
 * games that navigate with arrows (Beyond Zork's menus) work. Returns the ZSCII
 * code, or null at end of input.
 *
 * A whole escape sequence arrives buffered together in raw mode, so a single
 * `readSync` into a small buffer grabs it in one call — and a lone key comes back
 * as one byte, sidestepping the ESC-vs-escape-sequence ambiguity of byte-at-a-time
 * reads.
 */
export function readKeySync(): number | null {
  const stdin = process.stdin;

  if (stdin.isTTY) stdin.setRawMode(true);

  const buf = Buffer.alloc(8);
  let n = 0;

  for (;;) {
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
    }
    break;
  }

  if (stdin.isTTY) stdin.setRawMode(false);

  if (n <= 0) return null; // EOF

  if (n >= 3 && buf[0] === 0x1b && (buf[1] === 0x5b || buf[1] === 0x4f)) {
    const arrow = { 0x41: 129, 0x42: 130, 0x44: 131, 0x43: 132 }[buf[2]];
    if (arrow !== undefined) return arrow; // up / down / left / right
  }

  const first = buf[0];
  return first === 0x0a ? 0x0d : first; // normalize LF to Return (13)
}
