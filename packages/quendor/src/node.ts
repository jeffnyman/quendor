/**
 * Quendor's node-only entry (`quendor/node`).
 *
 * The engine itself (`./index.ts`) is pure and browser-safe. This entry adds the
 * conveniences that need `node:fs` — currently loading a story (bare `.z*` file
 * or Blorb) from disk. Keeping it separate means a browser bundle that imports
 * the engine never drags in node built-ins.
 */

export { loadStoryFromFile } from "./story-node.ts";
export { readLineSync, readCharSync } from "./stdin-node.ts";
