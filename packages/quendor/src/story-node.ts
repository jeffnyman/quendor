import { readFile } from "node:fs/promises";

/**
 * Load a story from a file path (Node only).
 *
 * Kept separate from `story.ts` so the core stays free of Node
 * built-ins and can be bundled for the browser
 */
export async function loadStoryFromFile(path: string): Promise<void> {
  await readFile(path);
}
