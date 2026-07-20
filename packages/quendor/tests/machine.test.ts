import { expect, test } from "vite-plus/test";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";
import { Machine } from "../src/machine.ts";

function buildStory(): Story {
  const bytes = new Uint8Array(64);

  bytes[HeaderOffset.Version] = 3;

  return new Story(bytes);
}

test("stamps the interpreter number and version into memory", () => {
  const machine = new Machine(buildStory());

  expect(machine.memory.readByte(HeaderOffset.InterpreterNumber)).toBe(6);
  expect(machine.memory.readByte(HeaderOffset.InterpreterVersion)).toBe(0x41);
});

test("exposes the interpreter number and version it wrote", () => {
  const machine = new Machine(buildStory());

  expect(machine.interpreterNumber).toBe(6);
  expect(machine.interpreterVersion).toBe(0x41);
});

test("shares the story's memory rather than copying it", () => {
  const story = buildStory();
  const machine = new Machine(story);

  expect(machine.memory).toBe(story.memory);
});
