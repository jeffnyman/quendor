/**
 * Node-only stdin helper, shared by the `quendor` player and the `zexp`
 * debugger CLIs. Lives here (not in the pure engine) because it needs
 * `node:fs`; exposed through `quendor/node`.
 */

import { readSync } from "node:fs";

/**
 * Read one line from stdin synchronously, to fit the tight run loop (the
 * machine blocks on input between instructions). Returns the line without its
 * trailing newline, or null at end of input.
 */
export function readLineSync(): string | null {
  const buf = Buffer.alloc(1);
  let line = "";
  let sawAny = false;

  for (;;) {
    let n: number;

    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
      break; // EOF or closed stream
    }

    if (n === 0) break; // EOF

    sawAny = true;

    const ch = buf.toString("utf8");

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

  const buf = Buffer.alloc(1);
  let ch: string | null = null;

  for (;;) {
    let n: number;

    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
      break; // EOF or closed stream
    }

    if (n === 0) break; // EOF

    ch = buf.toString("utf8");
    break;
  }

  if (stdin.isTTY) stdin.setRawMode(false);

  return ch;
}
