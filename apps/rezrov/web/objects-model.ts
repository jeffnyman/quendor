import type { Machine } from "quendor";
import { escapeHtml, signed } from "./format.ts";

const MAX_ROWS = 4000;
const MAX_DEPTH = 64;
const MAX_OBJECTS = 1000;

/** The subset of the object table the tree walk needs (parent/child/sibling). */
export interface ObjectTree {
  getParent(n: number): number;
  getChild(n: number): number;
  getSibling(n: number): number;
}

export interface ObjectNode {
  readonly n: number;
  readonly depth: number;
}

/**
 * Depth-first visitation order of the object tree: each root (parent 0) followed
 * by its descendants down the sibling chain, then any orphan objects a malformed
 * table left unreachable. Guards against cycles and runaway size.
 */
export function walkObjectTree(objects: ObjectTree, count: number): ObjectNode[] {
  const limit = Math.min(count, MAX_OBJECTS);
  const visited = new Set<number>();
  const nodes: ObjectNode[] = [];

  const visit = (n: number, depth: number): void => {
    if (visited.has(n) || nodes.length > MAX_ROWS || depth > MAX_DEPTH) return;
    visited.add(n);
    nodes.push({ n, depth });

    let c = objects.getChild(n);
    while (c !== 0 && !visited.has(c)) {
      visit(c, depth + 1);
      c = objects.getSibling(c);
    }
  };

  for (let n = 1; n <= limit; n++) {
    if (objects.getParent(n) === 0) visit(n, 0);
  }
  // Objects unreachable from any root (a malformed table) — show them anyway.
  for (let n = 1; n <= limit; n++) {
    if (!visited.has(n)) visit(n, 0);
  }

  return nodes;
}

function objectName(machine: Machine, n: number): string {
  try {
    const addr = machine.objects.getShortNameAddress(n);
    const nameLen = machine.readMemoryByte(addr); // 0 => no short name
    return nameLen > 0 ? machine.text.decodeAtAddress(addr + 1) : "";
  } catch {
    return "";
  }
}

/**
 * Interpret a 16-bit property word by likely meaning: a dictionary reference
 * (its address is specific) wins; else a valid object number shows that
 * object's name; otherwise it's a signed number.
 */
function interpretWord(machine: Machine, w: number, objectCount: number): string {
  const dictWord = machine.getDictionaryWord(w);
  if (dictWord) return `"${dictWord}"`;

  if (w >= 1 && w <= objectCount) {
    const name = objectName(machine, w);
    if (name) return `{${name}}`;
  }

  return String(signed(w));
}

function interpretProperty(
  machine: Machine,
  dataAddress: number,
  length: number,
  objectCount: number,
): string {
  // A single byte is often an object reference (e.g. a room exit).
  if (length === 1) return interpretWord(machine, machine.readMemoryByte(dataAddress), objectCount);

  // Otherwise interpret word-shaped data as a sequence of 16-bit values.
  if (length === 0 || length % 2 !== 0 || length > 16) return "";

  const parts: string[] = [];
  for (let i = 0; i < length; i += 2) {
    parts.push(interpretWord(machine, machine.readMemoryWord(dataAddress + i), objectCount));
  }
  return parts.join(" ");
}

function objectDetailHtml(machine: Machine, n: number, depth: number, objectCount: number): string {
  const objects = machine.objects;
  const pad = 8 + (depth + 1) * 14;
  let attrs = "";
  let props = "";

  try {
    const set = objects.getSetAttributes(n);
    attrs = `attrs: ${set.length ? set.join(", ") : "none"}`;
    props = objects
      .readProperties(n)
      .map((p) => {
        const bytes: string[] = [];
        for (let i = 0; i < p.length; i++) {
          bytes.push(
            machine
              .readMemoryByte(p.dataAddress + i)
              .toString(16)
              .padStart(2, "0"),
          );
        }
        const interp = interpretProperty(machine, p.dataAddress, p.length, objectCount);
        const meaning = interp ? ` <span class="dim">= ${escapeHtml(interp)}</span>` : "";
        return `<div>P${p.number}: <span class="num">${bytes.join(" ")}</span>${meaning}</div>`;
      })
      .join("");
  } catch {
    attrs = "(unreadable)";
  }

  return (
    `<div class="objdetail" style="padding-left:${pad}px">` +
    `<div class="dim">parent ${objects.getParent(n)} · sibling ${objects.getSibling(n)} · child ${objects.getChild(n)}</div>` +
    `<div class="dim">${attrs}</div>${props}</div>`
  );
}

/** One object row: the collapsible summary line, plus its detail when expanded. */
function objectRowHtml(
  machine: Machine,
  n: number,
  depth: number,
  expanded: ReadonlySet<number>,
  count: number,
): string {
  const isExp = expanded.has(n);
  const name = objectName(machine, n);
  const row =
    `<div class="objrow" data-obj="${n}" style="padding-left:${8 + depth * 14}px">` +
    `<span class="chev">${isExp ? "▾" : "▸"}</span> ` +
    `<span class="num">${n}</span> ` +
    `${name ? escapeHtml(name) : '<span class="dim">(no name)</span>'}</div>`;
  return isExp ? row + objectDetailHtml(machine, n, depth, count) : row;
}

/** The object-tree panel as HTML: one row per object, with expandable detail. */
export function objectsHtml(machine: Machine, expanded: ReadonlySet<number>): string {
  let count: number;
  try {
    count = machine.objects.getObjectCount();
  } catch {
    return `<div class="empty">no object table</div>`;
  }

  let html = "";
  for (const { n, depth } of walkObjectTree(machine.objects, count)) {
    html += objectRowHtml(machine, n, depth, expanded, count);
  }

  const limit = Math.min(count, MAX_OBJECTS);
  if (count > limit) html += `<div class="empty">…and ${count - limit} more</div>`;
  return html;
}
