import { expect, test } from "vite-plus/test";
import { fileURLToPath } from "node:url";
import { loadStoryFromFile } from "../src/node.ts";
import { Machine } from "../src/machine.ts";

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

    machine.run();

    expect(out).toContain(verdict);
  });
}
