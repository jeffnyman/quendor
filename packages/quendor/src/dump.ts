import type { Story } from "./story.ts";
import { computeChecksum } from "./header.ts";

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

function hex(n: number, width = 4): string {
  return "0x" + n.toString(16).padStart(width, "0");
}
