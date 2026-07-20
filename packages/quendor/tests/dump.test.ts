import { expect, test } from "vite-plus/test";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";
import { dumpHeader } from "../src/dump.ts";

function buildStory(fill: (bytes: Uint8Array) => void): Story {
  const bytes = new Uint8Array(80);

  bytes[HeaderOffset.Version] = 3; // scale 2
  bytes[HeaderOffset.FileLength + 1] = 40; // 40 * 2 = 80

  for (let i = 0x40; i < 80; i++) {
    bytes[i] = 1;
  }

  fill(bytes);

  return new Story(bytes);
}

test("dumpHeader reports version, release, and serial number", () => {
  const story = buildStory((bytes) => {
    bytes[HeaderOffset.Release + 1] = 3;

    const serial = "861222";

    for (let i = 0; i < serial.length; i++) {
      bytes[HeaderOffset.SerialNumber + i] = serial.charCodeAt(i);
    }
  });

  const output = dumpHeader(story);

  expect(output).toMatch(/Z-code version\s+3/);
  expect(output).toMatch(/Release number\s+3/);
  expect(output).toContain("861222");
});

test("dumpHeader marks a matching checksum", () => {
  const story = buildStory((bytes) => {
    bytes[HeaderOffset.Checksum + 1] = 80 - 0x40; // 16 bytes of value 1
  });

  expect(dumpHeader(story)).toContain("✓ match");
});

test("dumpHeader marks a mismatched checksum", () => {
  const story = buildStory((bytes) => {
    bytes[HeaderOffset.Checksum + 1] = 99; // deliberately wrong
  });

  expect(dumpHeader(story)).toContain("✗ MISMATCH");
});
