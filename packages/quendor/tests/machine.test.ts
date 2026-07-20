import { expect, test } from "vite-plus/test";
import { Story } from "../src/story.ts";
import { HeaderOffset } from "../src/header.ts";
import { Machine } from "../src/machine.ts";

function buildStory(size: number, fill: (bytes: Uint8Array) => void): Story {
  const bytes = new Uint8Array(size);

  fill(bytes);

  return new Story(bytes);
}

test("stamps the interpreter number and version into memory", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
  );

  expect(machine.memory.readByte(HeaderOffset.InterpreterNumber)).toBe(6);
  expect(machine.memory.readByte(HeaderOffset.InterpreterVersion)).toBe(0x41);
});

test("exposes the interpreter number and version it wrote", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
    }),
  );

  expect(machine.interpreterNumber).toBe(6);
  expect(machine.interpreterVersion).toBe(0x41);
});

test("shares the story's memory rather than copying it", () => {
  const story = buildStory(64, (bytes) => {
    bytes[HeaderOffset.Version] = 3;
  });
  const machine = new Machine(story);

  expect(machine.memory).toBe(story.memory);
});

test("v1-5/7/8: the initial frame has no locals and starts at the header's byte address", () => {
  const machine = new Machine(
    buildStory(64, (bytes) => {
      bytes[HeaderOffset.Version] = 3;
      bytes[HeaderOffset.InitialProgramCounter + 1] = 40; // byte address 40
    }),
  );

  expect(machine.currentFrame.routineAddress).toBe(40);
  expect(machine.currentFrame.locals).toEqual([]);
});

test("v6: unpacks the packed main-routine address and reads its header", () => {
  const machine = new Machine(
    buildStory(70, (bytes) => {
      bytes[HeaderOffset.Version] = 6;
      bytes[HeaderOffset.InitialProgramCounter + 1] = 15; // packed address 15
      bytes[60] = 2; // routine header: 2 locals (v6 -> initial values are 0)
    }),
  );

  expect(machine.currentFrame.routineAddress).toBe(60); // 15 * 4 + routinesOffset(0) * 8
  expect(machine.currentFrame.locals).toEqual([0, 0]);
});
