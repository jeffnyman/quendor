import { readFile } from "node:fs/promises";
import { Story } from "./story.ts";

/**
 * Load a story from a file path (Node only).
 *
 * Kept separate from `story.ts` so the core stays free of Node
 * built-ins and can be bundled for the browser
 */
export async function loadStoryFromFile(path: string): Promise<Story> {
  const buffer = await readFile(path);

  return new Story(new Uint8Array(buffer));
}
