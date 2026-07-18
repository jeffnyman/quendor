import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MARKER = "<!--VITE PLUS END-->";
const SOURCE = "AGENTS.md";
const TARGETS = [
  "CLAUDE.md",
  ".cursor/rules/viteplus.mdc",
  ".aiassistant/rules/viteplus.md",
  ".github/copilot-instructions.md",
];

function sectionAfterMarker(content, file) {
  const index = content.indexOf(MARKER);
  if (index === -1) {
    throw new Error(`Missing "${MARKER}" marker in ${file}`);
  }
  return content.slice(index + MARKER.length);
}

const syncedSection = sectionAfterMarker(readFileSync(SOURCE, "utf8"), SOURCE);
const changed = [];

for (const target of TARGETS) {
  const targetContent = readFileSync(target, "utf8");
  const index = targetContent.indexOf(MARKER);
  if (index === -1) {
    throw new Error(`Missing "${MARKER}" marker in ${target}`);
  }
  const head = targetContent.slice(0, index + MARKER.length);
  const nextContent = head + syncedSection;
  if (nextContent !== targetContent) {
    writeFileSync(target, nextContent);
    changed.push(target);
  }
}

if (changed.length > 0) {
  execFileSync("git", ["add", ...changed]);
  console.log(`Synced agent docs from ${SOURCE} into: ${changed.join(", ")}`);
}
