import type { Story } from "./story.ts";
import { computeChecksum } from "./header.ts";
import { ObjectTable } from "./objects.ts";

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

/**
 * Every object with its short name, set attributes, tree links
 * (parent/sibling/child) and properties (number → data bytes in hex).
 */
export function dumpObjects(story: Story): string {
  const objects = new ObjectTable(
    story.memory,
    story.header.version,
    story.header.objectTableAddress,
  );
  const count = objects.getObjectCount();
  const lines: string[] = [`Objects: ${count}`, ""];

  for (let n = 1; n <= count; n++) {
    const nameAddr = objects.getShortNameAddress(n);
    // The first byte is the short-name length (in words); 0 means no name.
    const name =
      story.memory.readByte(nameAddr) === 0 ? "" : story.text.decodeAtAddress(nameAddr + 1);

    lines.push(`[${n}] ${JSON.stringify(name)}`);

    const attrs = objects.getSetAttributes(n);

    lines.push(`     Attributes: ${attrs.length ? attrs.join(", ") : "none"}`);
    lines.push(
      `     Parent: ${objects.getParent(n)}  Sibling: ${objects.getSibling(n)}  Child: ${objects.getChild(n)}`,
    );

    const props = objects.readProperties(n);

    if (props.length === 0) {
      lines.push("     Properties: none");
    } else {
      lines.push("     Properties:");

      for (const p of props) {
        let bytes = "";

        for (let i = 0; i < p.length; i++) {
          bytes +=
            (i ? " " : "") +
            story.memory
              .readByte(p.dataAddress + i)
              .toString(16)
              .padStart(2, "0");
        }

        lines.push(`       [${p.number}] ${bytes}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * The dictionary: word separators, entry metadata, and every entry's decoded
 * word plus its trailing data bytes (grammar/parser flags) in hex.
 */
export function dumpDictionary(story: Story): string {
  const m = story.memory;
  let addr = story.header.dictionaryAddress;
  const sepCount = m.readByte(addr++);
  const seps: string[] = [];

  for (let i = 0; i < sepCount; i++) {
    seps.push(String.fromCharCode(m.readByte(addr++)));
  }

  const entryLength = m.readByte(addr++);
  let count = m.readWord(addr);

  addr += 2;

  const sorted = count < 0x8000;

  if (!sorted) count = 0x10000 - count;

  const wordBytes = story.header.version <= 3 ? 4 : 6; // encoded-word length

  const lines = [
    `Dictionary: ${count} entries`,
    `  Word separators: ${JSON.stringify(seps.join(""))}`,
    `  Entry length: ${entryLength} bytes (${sorted ? "sorted" : "unsorted"})`,
    "",
  ];

  for (let i = 0; i < count; i++) {
    const entryAddr = addr + i * entryLength;
    let word: string;

    try {
      word = story.text.decodeAtAddress(entryAddr).trim();
    } catch {
      word = "<?>";
    }

    let data = "";

    for (let j = wordBytes; j < entryLength; j++) {
      data +=
        (data ? " " : "") +
        m
          .readByte(entryAddr + j)
          .toString(16)
          .padStart(2, "0");
    }

    lines.push(`  ${JSON.stringify(word)}${data ? "  " + data : ""}`);
  }

  return lines.join("\n");
}

/** The combined header + abbreviations + objects + dictionary dump. */
export function dumpAll(story: Story): string {
  return [
    "=== HEADER ===",
    "",
    dumpHeader(story),
    "",
    "=== ABBREVIATIONS ===",
    "",
    dumpAbbreviations(story),
    "",
    "=== OBJECTS ===",
    "",
    dumpObjects(story),
    "",
    "=== DICTIONARY ===",
    "",
    dumpDictionary(story),
  ].join("\n");
}

function hex(n: number, width = 4): string {
  return "0x" + n.toString(16).padStart(width, "0");
}
