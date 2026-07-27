import { expect, test } from "vite-plus/test";
import { keyToZscii } from "../web/keys.ts";

/** A minimal keydown event — keyToZscii only reads `.key`. */
const key = (k: string): KeyboardEvent => ({ key: k }) as unknown as KeyboardEvent;

test("maps named control keys to ZSCII", () => {
  expect(keyToZscii(key("Enter"))).toBe(13);
  expect(keyToZscii(key("Escape"))).toBe(27);
  expect(keyToZscii(key("Backspace"))).toBe(8);
  expect(keyToZscii(key("Tab"))).toBe(9);
});

test("maps arrow keys to ZSCII 129-132", () => {
  expect(keyToZscii(key("ArrowUp"))).toBe(129);
  expect(keyToZscii(key("ArrowDown"))).toBe(130);
  expect(keyToZscii(key("ArrowLeft"))).toBe(131);
  expect(keyToZscii(key("ArrowRight"))).toBe(132);
});

test("passes printable ASCII through as its char code", () => {
  expect(keyToZscii(key("a"))).toBe(97);
  expect(keyToZscii(key(" "))).toBe(32);
  expect(keyToZscii(key("~"))).toBe(126);
});

test("maps function keys F1-F12 to ZSCII 133-144", () => {
  expect(keyToZscii(key("F1"))).toBe(133);
  expect(keyToZscii(key("F12"))).toBe(144);
});

test("returns null for keys with no ZSCII mapping", () => {
  expect(keyToZscii(key("Shift"))).toBeNull();
  expect(keyToZscii(key("F13"))).toBeNull(); // outside F1-F12
  expect(keyToZscii(key("Dead"))).toBeNull();
});
