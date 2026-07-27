import { expect, test } from "vite-plus/test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { loadStoryFromFile } from "../src/node.ts";
import { Machine, RunState } from "../src/machine.ts";
import { runAcceptance } from "../src/cli.ts";

// End-to-end conformance: run the vendored czech suite through the engine and
// check its own verdict. czech self-checks each opcode and prints the result,
// so a regression shows up as a non-zero Failed count. Run in-process (not via
// the CLI) so the executed opcodes count toward machine.ts coverage, and with a
// fixed seed so czech's `random` test is reproducible. The header section of
// czech's output is interpreter identity ("No tests"), so we assert the summary
// line rather than diffing the whole transcript (see fixtures/README.md).
// One suite per vendored Z-code version. v4 exercises more opcodes, so czech
// reports a higher passing count — hence the distinct expected verdicts.
const suites = [
  { version: 3, file: "czech.z3", verdict: "Passed: 349, Failed: 0, Print tests: 19" },
  { version: 4, file: "czech.z4", verdict: "Passed: 367, Failed: 0, Print tests: 19" },
  { version: 5, file: "czech.z5", verdict: "Passed: 406, Failed: 0, Print tests: 19" },
];

for (const { version, file, verdict } of suites) {
  test(`passes the czech v${version} conformance suite`, async () => {
    const path = fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url));
    const story = await loadStoryFromFile(path);
    const machine = new Machine(story, { randomSeed: 1 });

    let out = "";
    machine.onOutput = (text): void => {
      out += text;
    };

    // czech prints far more than a screenful, so run() yields at [More] pauses;
    // page through them (czech takes no input, so every yield is a [More]).
    for (let state = machine.run(); state === RunState.WaitingForInput; state = machine.run()) {
      machine.continueFromMore();
    }

    expect(out).toContain(verdict);
  });
}

// The acceptance harness (quendor --accept) replayed against a golden transcript.
// czech takes no input, so the "solution" is empty and its whole self-test output
// is captured, then diffed byte-for-byte against a committed golden. The suites
// above assert only the summary line; this pins the entire transcript, so any drift
// in opcode output, text encoding, or the RNG surfaces as a diff. It is the
// CI-safe twin of the local Zork acceptance runs (czech is freely redistributable;
// commercial games' goldens are generated locally and never committed).
test("acceptance: czech v3 replays byte-for-byte to its committed golden transcript", async () => {
  const storyPath = fileURLToPath(new URL("./fixtures/czech.z3", import.meta.url));
  const goldenPath = fileURLToPath(new URL("./fixtures/czech.z3.golden.txt", import.meta.url));
  const story = await loadStoryFromFile(storyPath);

  const result = runAcceptance(new Machine(story, { randomSeed: 1, screenWidth: 80 }), []);

  expect(result.outcome).toBe("halted");
  expect(result.transcript).toBe(readFileSync(goldenPath, "utf8"));
});
