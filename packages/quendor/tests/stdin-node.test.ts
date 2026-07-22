import { afterEach, expect, test, vi } from "vite-plus/test";
import { readSync } from "node:fs";
import { readLineSync } from "../src/stdin-node.ts";

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
