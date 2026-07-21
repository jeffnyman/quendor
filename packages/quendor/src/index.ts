/**
 * Quendor — the public API of the Z-Machine engine.
 *
 * This is the boundary between the interpreter/engine and anything built on top
 * of it (the zdebug web debugger, the CLI, tests). Everything re-exported here is
 * pure — no DOM, no node — so it runs in a browser or in node unchanged. The
 * node-only story loader lives in a separate entry, `./node.ts` (`quendor/node`),
 * so importing the engine never pulls in `node:fs`.
 *
 * Consumers should import from here rather than reaching into `./<module>.js`.
 */

export function fn(): string {
  return "Quendor Z-Machine Interpreter and Debugger";
}

// --- execution -------------------------------------------------------------
export * from "./machine.js"; // Machine, Frame
export * from "./story.js"; // Story
export * from "./memory.js"; // Memory

// --- header ----------------------------------------------------------------
export * from "./header.js"; // readHeader, Header, HeaderOffset, computeChecksum

// --- text / objects --------------------------------------------------------
export * from "./text.js"; // ZText, DecodeFlags, DEFAULT_FLAGS
export * from "./alphabet.js"; // AlphabetTable
export * from "./objects.js"; // ObjectTable

// --- tooling ---------------------------------------------------------------
export * from "./dump.ts"; // dumpAll, dumpHeader, dumpObjects, dumpAbbreviations, dumpDictionary
