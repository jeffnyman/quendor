import { expect, test } from "vite-plus/test";
import { HeaderOffset } from "../src/header.ts";
import { assertStoryImage, Story } from "../src/story.ts";

test("readAbbreviations decodes all 96 entries", () => {
  const abbrevTableAddress = 64;
  const sharedWordAddress = 150; // byte address 300
  const zword = (6 << 10) | (5 << 5) | 5 | 0x8000; // "a", terminated

  const bytes = new Uint8Array(310);

  bytes[HeaderOffset.Version] = 3;
  bytes[HeaderOffset.AbbreviationsTableAddress] = (abbrevTableAddress >> 8) & 0xff;
  bytes[HeaderOffset.AbbreviationsTableAddress + 1] = abbrevTableAddress & 0xff;

  // All 96 entries point at the same shared, single-word string.
  for (let i = 0; i < 96; i++) {
    bytes[abbrevTableAddress + i * 2] = (sharedWordAddress >> 8) & 0xff;
    bytes[abbrevTableAddress + i * 2 + 1] = sharedWordAddress & 0xff;
  }

  bytes[300] = (zword >> 8) & 0xff;
  bytes[301] = zword & 0xff;

  const abbreviations = new Story(bytes).readAbbreviations();

  expect(abbreviations).toHaveLength(96);
  expect(abbreviations.every((text) => text === "a")).toBe(true);
});

test("assertStoryImage accepts a well-formed story image", () => {
  const bytes = new Uint8Array(64);
  bytes[HeaderOffset.Version] = 3;

  expect(() => assertStoryImage(bytes)).not.toThrow();
});

test("assertStoryImage rejects a file too short to hold a header, naming the source", () => {
  expect(() => assertStoryImage(new Uint8Array(10), "notes.txt")).toThrow(
    /notes\.txt is not a Z-code story file/,
  );
});

test("assertStoryImage rejects a version byte outside 1-8", () => {
  const bytes = new Uint8Array(64); // version byte defaults to 0

  expect(() => assertStoryImage(bytes)).toThrow(/version byte 0x00/);
});

test("assertStoryImage rejects an empty file", () => {
  expect(() => assertStoryImage(new Uint8Array(0))).toThrow(/0 bytes/);
});
