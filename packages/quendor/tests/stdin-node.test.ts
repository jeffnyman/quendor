import { afterEach, expect, test, vi } from "vite-plus/test";
import { readSync } from "node:fs";
import { readLineSync, readCharSync, readKeySync } from "../src/stdin-node.ts";

vi.mock("node:fs", () => ({ readSync: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** Make readSync deliver `input`'s bytes one call at a time, then EOF (0). */
function feed(input: string): void {
  const bytes = Array.from(input).map((c) => c.charCodeAt(0));
  let i = 0;

  vi.mocked(readSync).mockImplementation(((_fd: number, buffer: Buffer): number => {
    if (i >= bytes.length) return 0; // EOF

    buffer[0] = bytes[i++];

    return 1;
  }) as unknown as typeof readSync);
}

test("reads a line up to the newline, without the newline", () => {
  feed("hello\n");

  expect(readLineSync()).toBe("hello");
});

test("strips a carriage return before the newline", () => {
  feed("hi\r\n");

  expect(readLineSync()).toBe("hi");
});

test("returns the buffered text at end of input with no trailing newline", () => {
  feed("bye");

  expect(readLineSync()).toBe("bye");
});

test("returns null at immediate end of input", () => {
  feed("");

  expect(readLineSync()).toBeNull();
});

test("retries the read when it raises EAGAIN", () => {
  const bytes = Array.from("x\n").map((c) => c.charCodeAt(0));
  let i = 0;
  let threw = false;

  vi.mocked(readSync).mockImplementation(((_fd: number, buffer: Buffer): number => {
    if (!threw) {
      threw = true;

      const err = new Error("resource temporarily unavailable") as NodeJS.ErrnoException;
      err.code = "EAGAIN";

      throw err;
    }

    if (i >= bytes.length) return 0;

    buffer[0] = bytes[i++];

    return 1;
  }) as unknown as typeof readSync);

  expect(readLineSync()).toBe("x");
});

test("stops on a non-EAGAIN read error, returning null when nothing was read", () => {
  vi.mocked(readSync).mockImplementation(() => {
    throw new Error("stream closed");
  });

  expect(readLineSync()).toBeNull();
});

test("readCharSync returns one byte and leaves raw mode alone when not a TTY", () => {
  feed("k");

  expect(readCharSync()).toBe("k");
});

test("readCharSync toggles raw mode on and off around the read on a TTY", () => {
  feed("q");

  const stdin = process.stdin;
  const isTTYDesc = Object.getOwnPropertyDescriptor(stdin, "isTTY");
  const rawDesc = Object.getOwnPropertyDescriptor(stdin, "setRawMode");
  const setRawMode = vi.fn();

  Object.defineProperty(stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(stdin, "setRawMode", { value: setRawMode, configurable: true });

  try {
    expect(readCharSync()).toBe("q");
    expect(setRawMode.mock.calls).toEqual([[true], [false]]);
  } finally {
    Object.defineProperty(stdin, "isTTY", isTTYDesc ?? { value: undefined, configurable: true });
    Object.defineProperty(stdin, "setRawMode", rawDesc ?? { value: undefined, configurable: true });
  }
});

/** Deliver all of `bytes` in a single read, the way a buffered escape sequence arrives. */
function feedChunk(bytes: number[]): void {
  let done = false;

  vi.mocked(readSync).mockImplementation(((_fd: number, buffer: Buffer): number => {
    if (done) return 0;
    done = true;
    bytes.forEach((b, i) => {
      buffer[i] = b;
    });

    return bytes.length;
  }) as unknown as typeof readSync);
}

test("readKeySync decodes arrow-key escape sequences to ZSCII 129-132", () => {
  feedChunk([0x1b, 0x5b, 0x41]);
  expect(readKeySync()).toBe(129); // up
  feedChunk([0x1b, 0x5b, 0x42]);
  expect(readKeySync()).toBe(130); // down
  feedChunk([0x1b, 0x5b, 0x44]);
  expect(readKeySync()).toBe(131); // left
  feedChunk([0x1b, 0x5b, 0x43]);
  expect(readKeySync()).toBe(132); // right
  feedChunk([0x1b, 0x4f, 0x41]);
  expect(readKeySync()).toBe(129); // SS3 form (application cursor keys)
});

test("readKeySync returns a plain key's code and normalizes LF to Return", () => {
  feedChunk([0x78]);
  expect(readKeySync()).toBe(0x78); // 'x'
  feedChunk([0x0a]);
  expect(readKeySync()).toBe(0x0d); // LF -> Return
});

test("readKeySync returns null at end of input", () => {
  feedChunk([]);
  expect(readKeySync()).toBeNull();
});

test("readKeySync passes through an unrecognized escape sequence as its first byte", () => {
  feedChunk([0x1b, 0x5b, 0x5a]); // ESC [ Z — not an arrow
  expect(readKeySync()).toBe(0x1b); // falls through to the ESC byte
});

test("readKeySync toggles raw mode on and off around the read on a TTY", () => {
  feedChunk([0x6b]); // 'k'

  const stdin = process.stdin;
  const isTTYDesc = Object.getOwnPropertyDescriptor(stdin, "isTTY");
  const rawDesc = Object.getOwnPropertyDescriptor(stdin, "setRawMode");
  const setRawMode = vi.fn();

  Object.defineProperty(stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(stdin, "setRawMode", { value: setRawMode, configurable: true });

  try {
    expect(readKeySync()).toBe(0x6b);
    expect(setRawMode.mock.calls).toEqual([[true], [false]]);
  } finally {
    Object.defineProperty(stdin, "isTTY", isTTYDesc ?? { value: undefined, configurable: true });
    Object.defineProperty(stdin, "setRawMode", rawDesc ?? { value: undefined, configurable: true });
  }
});

test("readKeySync retries on EAGAIN, then returns null on a non-EAGAIN error", () => {
  let threw = false;
  vi.mocked(readSync).mockImplementation(() => {
    if (!threw) {
      threw = true;
      const err = new Error("try again") as NodeJS.ErrnoException;
      err.code = "EAGAIN";
      throw err;
    }
    throw new Error("stream closed"); // non-EAGAIN -> stop, n stays 0
  });

  expect(readKeySync()).toBeNull();
});
