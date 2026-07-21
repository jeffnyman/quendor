import type { Story } from "./story.ts";
import { computeChecksum } from "./header.ts";

/** The header fields, formatted as an aligned key/value block. */
export function dumpHeader(story: Story): string {
  const h = story.header;
  const actual = computeChecksum(story.memory, h);
  const ok = h.checksum === actual;
  const rows: [string, string][] = [
    ["Z-code version", String(h.version)],
    ["Release number", String(h.release)],
    ["Serial number", h.serialNumber],
    ["File size on disk", `${story.memory.size} bytes`],
    ["Start PC", hex(h.initialProgramCounter)],
    ["High memory base", hex(h.highMemoryBase)],
    ["Static memory base", hex(h.staticMemoryBase)],
    ["Dictionary address", hex(h.dictionaryAddress)],
    ["Object table address", hex(h.objectTableAddress)],
    ["Global variables address", hex(h.globalVariablesTableAddress)],
    ["Abbreviations address", hex(h.abbreviationsTableAddress)],
    ["File length (header)", `${h.fileLength} bytes (${hex(h.fileLength, 5)})`],
    ["Checksum (header)", hex(h.checksum)],
    ["Checksum (computed)", `${hex(actual)} ${ok ? "✓ match" : "✗ MISMATCH"}`],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));

  return rows.map(([k, v]) => `${k.padEnd(w)}  ${v}`).join("\n");
}

/**
 * The abbreviation table (decoded). v1 has none; v2 has 32; v3+ has 96.
 */
export function dumpAbbreviations(story: Story): string {
  const v = story.header.version;
  const count = v >= 3 ? 96 : v === 2 ? 32 : 0;

  if (count === 0 || story.header.abbreviationsTableAddress === 0) {
    return "Abbreviations: none";
  }

  const abbrevs = story.readAbbreviations().slice(0, count);
  const lines = [`Abbreviations: ${count}`, ""];

  abbrevs.forEach((t, i) => {
    lines.push(`  [${String(i).padStart(2)}] ${JSON.stringify(t)}`);
  });

  return lines.join("\n");
}

export function dumpAll(story: Story): string {
  return [
    "=== HEADER ===",
    "",
    dumpHeader(story),
    "",
    "=== ABBREVIATIONS ===",
    "",
    dumpAbbreviations(story),
  ].join("\n");
}

function hex(n: number, width = 4): string {
  return "0x" + n.toString(16).padStart(width, "0");
}
