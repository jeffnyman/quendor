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

// --- tooling ---------------------------------------------------------------
export * from "./dump.ts"; // dumpHeader
