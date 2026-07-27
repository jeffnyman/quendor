# Test fixtures

## czech (Comprehensive Z-machine Emulation CHecker)

The **czech** conformance suite (v0.8) by Amir Karger — a freely-redistributable
Z-machine test program that self-checks a large fraction of the opcode set and
prints a pass/fail report. One story file per supported Z-code version is
vendored here (rather than read from the optional `entharion` submodule) so the
conformance tests run in CI, which does not check out submodules.

Source (Inform 6): `entharion/zcode-checkers-source/czech/czech.inf`

### czech.z3 (v3)

- Reference transcript: `entharion/zcode-checkers/czech/czech.out3`
- Expected verdict: `Passed: 349, Failed: 0, Print tests: 19`

### czech.z4 (v4)

- Reference transcript: `entharion/zcode-checkers/czech/czech.out4`
- Expected verdict: `Passed: 367, Failed: 0, Print tests: 19`

### czech.z5 (v5)

- Reference transcript: `entharion/zcode-checkers/czech/czech.out5`
- Expected verdict: `Passed: 406, Failed: 0, Print tests: 19`

The header section of czech's output reports interpreter identity/flags, which
differ per interpreter and are marked "No tests" — so the conformance tests
assert czech's own summary line rather than diffing the whole transcript.

### czech.z3.golden.txt (acceptance golden)

A byte-for-byte transcript of czech.z3 played through the acceptance harness
(`runAcceptance`, seed 1, 80-column screen — czech takes no input, so the solution
is empty). `czech.test.ts` diffs a live run against it, pinning the _entire_
transcript, so any drift in opcode output, text encoding, or the RNG shows up as a
diff — stricter than the summary-line checks above. It's the CI-safe counterpart of
the local `--accept` playthroughs of commercial games (whose goldens embed
copyrighted text and are `.gitignore`d, never committed). Regenerate after an
intentional engine change and re-commit.
