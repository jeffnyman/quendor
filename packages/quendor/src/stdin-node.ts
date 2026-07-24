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
