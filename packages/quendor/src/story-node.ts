import { readFile } from "node:fs/promises";
import { Story } from "./story.ts";
import { unwrapStory } from "./blorb.ts";

/**
 * Load a story from a file path (Node only).
 *
 * Kept separate from `story.ts` so the core stays free of Node
 * built-ins and can be bundled for the browser, where a story
 * arrives as a `Uint8Array` (`new Story(bytes)`) instead.
 */
export async function loadStoryFromFile(path: string): Promise<Story> {
  const buffer = await readFile(path);

  return new Story(unwrapStory(new Uint8Array(buffer)));
}
