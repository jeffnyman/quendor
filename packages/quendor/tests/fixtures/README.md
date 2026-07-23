# Test fixtures

## czech.z3

The **czech** conformance suite (Comprehensive Z-machine Emulation CHecker,
v0.8) by Amir Karger — a freely-redistributable Z-machine test program that
self-checks a large fraction of the opcode set and prints a pass/fail report.

Vendored here (rather than read from the optional `entharion` submodule) so the
conformance test runs in CI, which does not check out submodules.

- Source (Inform 6): `entharion/zcode-checkers-source/czech/czech.inf`
- Reference transcript: `entharion/zcode-checkers/czech/czech.out3`
- Expected verdict: `Passed: 349, Failed: 0, Print tests: 19`

The header section of czech's output reports interpreter identity/flags, which
differ per interpreter and are marked "No tests" — so the conformance test
asserts czech's own summary line rather than diffing the whole transcript.
