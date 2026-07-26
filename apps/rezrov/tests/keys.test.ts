import { expect, test } from "vite-plus/test";
import { keyToZscii, shouldRedirectToInput } from "../web/keys.ts";

/** A minimal keydown event — keyToZscii only reads `.key`. */
const key = (k: string): KeyboardEvent => ({ key: k }) as unknown as KeyboardEvent;

const box = (disabled = false): HTMLInputElement => ({ disabled }) as unknown as HTMLInputElement;
const evt = (over: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    target: null,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    ...over,
  }) as unknown as KeyboardEvent;

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

test("shouldRedirectToInput: a plain key with the box enabled and unfocused → true", () => {
  expect(shouldRedirectToInput(evt(), box(false))).toBe(true);
});

test("shouldRedirectToInput: false when the box is disabled", () => {
  expect(shouldRedirectToInput(evt(), box(true))).toBe(false);
});

test("shouldRedirectToInput: false when the event already targets the box", () => {
  const input = box(false);
  expect(shouldRedirectToInput(evt({ target: input }), input)).toBe(false);
});

test("shouldRedirectToInput: false for modifier or IME keystrokes", () => {
  expect(shouldRedirectToInput(evt({ ctrlKey: true }), box())).toBe(false);
  expect(shouldRedirectToInput(evt({ metaKey: true }), box())).toBe(false);
  expect(shouldRedirectToInput(evt({ altKey: true }), box())).toBe(false);
  expect(shouldRedirectToInput(evt({ isComposing: true }), box())).toBe(false);
});
