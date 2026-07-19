import { expect, test } from "vite-plus/test";
import { parseBlorb, unwrapStory } from "../src/blorb.ts";

function writeFourCC(bytes: Uint8Array, offset: number, code: string): void {
  for (let i = 0; i < 4; i++) {
    bytes[offset + i] = code.charCodeAt(i);
  }
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2;
  const chunk = new Uint8Array(8 + data.length + pad);

  writeFourCC(chunk, 0, type);
  new DataView(chunk.buffer).setUint32(4, data.length);
  chunk.set(data, 8);

  return chunk;
}

function buildBlorb(chunks: { type: string; data: Uint8Array }[]): Uint8Array {
  const built = chunks.map(({ type, data }) => buildChunk(type, data));
  const length = built.reduce((total, chunk) => total + chunk.length, 0);
  const form = new Uint8Array(12 + length);

  writeFourCC(form, 0, "FORM");
  new DataView(form.buffer).setUint32(4, 4 + length);
  writeFourCC(form, 8, "IFRS");

  let offset = 12;

  for (const chunk of built) {
    form.set(chunk, offset);
    offset += chunk.length;
  }

  return form;
}

const ZCODE_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

test("parseBlorb returns null for bytes too short to be a Blorb", () => {
  expect(parseBlorb(new Uint8Array(4))).toBeNull();
});

test("parseBlorb returns null for non-Blorb bytes", () => {
  const bareStory = new Uint8Array(20).fill(0x42);

  expect(parseBlorb(bareStory)).toBeNull();
});

test("parseBlorb finds the ZCOD chunk", () => {
  const blorb = buildBlorb([
    { type: "RIdx", data: new Uint8Array(4) },
    { type: "ZCOD", data: ZCODE_BYTES },
  ]);

  expect(parseBlorb(blorb)?.story).toEqual(ZCODE_BYTES);
});

test("parseBlorb finds ZCOD after an odd-length chunk (padding)", () => {
  const blorb = buildBlorb([
    { type: "TEST", data: new Uint8Array(3) },
    { type: "ZCOD", data: ZCODE_BYTES },
  ]);

  expect(parseBlorb(blorb)?.story).toEqual(ZCODE_BYTES);
});

test("parseBlorb returns an undefined story when there is no ZCOD chunk", () => {
  const blorb = buildBlorb([{ type: "RIdx", data: new Uint8Array(4) }]);

  expect(parseBlorb(blorb)?.story).toBeUndefined();
});

test("unwrapStory returns the bytes unchanged for a non-Blorb file", () => {
  const bareStory = new Uint8Array(20).fill(0x42);

  expect(unwrapStory(bareStory)).toBe(bareStory);
});

test("unwrapStory extracts the ZCOD chunk from a Blorb file", () => {
  const blorb = buildBlorb([{ type: "ZCOD", data: ZCODE_BYTES }]);

  expect(unwrapStory(blorb)).toEqual(ZCODE_BYTES);
});

test("unwrapStory throws when a Blorb file has no ZCOD chunk", () => {
  const blorb = buildBlorb([{ type: "RIdx", data: new Uint8Array(4) }]);

  expect(() => unwrapStory(blorb)).toThrow("no ZCOD");
});
