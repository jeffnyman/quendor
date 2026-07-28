import { expect, test } from "vite-plus/test";
import type { Machine } from "quendor";
import { objectsHtml, walkObjectTree, type ObjectTree } from "../web/objects-model.ts";

type Links = { parent: number; child?: number; sibling?: number };

/** Build a fake object tree from a {number: links} spec (absent → 0). */
function tree(spec: Record<number, Links>): ObjectTree {
  const at = (n: number): Links | undefined => spec[n];
  return {
    getParent: (n: number): number => at(n)?.parent ?? 0,
    getChild: (n: number): number => at(n)?.child ?? 0,
    getSibling: (n: number): number => at(n)?.sibling ?? 0,
  };
}

test("visits each root then its descendants in depth-first order", () => {
  // 1 (root) → child 2 → child 4; 2's sibling is 3
  const t = tree({
    1: { parent: 0, child: 2 },
    2: { parent: 1, child: 4, sibling: 3 },
    3: { parent: 1 },
    4: { parent: 2 },
  });

  expect(walkObjectTree(t, 4)).toEqual([
    { n: 1, depth: 0 },
    { n: 2, depth: 1 },
    { n: 4, depth: 2 },
    { n: 3, depth: 1 },
  ]);
});

test("guards against a cyclic sibling chain (no infinite loop)", () => {
  // 1 (root) → child 2; 2's sibling points back to the already-visited root
  const t = tree({
    1: { parent: 0, child: 2 },
    2: { parent: 1, sibling: 1 },
  });

  expect(walkObjectTree(t, 2).map((x) => x.n)).toEqual([1, 2]);
});

test("shows orphan objects unreachable from any root, at depth 0", () => {
  // 2 and 3 point at each other as parents — neither is a root, and no root
  // reaches them, so they surface only in the orphan pass.
  const t = tree({
    1: { parent: 0 },
    2: { parent: 3 },
    3: { parent: 2 },
  });

  const nodes = walkObjectTree(t, 3);
  expect(nodes.map((x) => x.n)).toEqual([1, 2, 3]);
  expect(nodes.every((x) => x.depth === 0)).toBe(true);
});

test("returns nothing for an empty object table", () => {
  expect(walkObjectTree(tree({}), 0)).toEqual([]);
});

test("caps how deep it descends into the tree", () => {
  // A chain 70 deep: 1 → 2 → … → 70, each the child of the one above it.
  const spec: Record<number, Links> = {};
  for (let n = 1; n <= 70; n++) spec[n] = { parent: n - 1, child: n + 1 };
  spec[1].parent = 0;
  spec[70].child = 0;

  // Without the depth guard the chain would reach depth 69; it holds at 64.
  const nodes = walkObjectTree(tree(spec), 70);
  expect(Math.max(...nodes.map((x) => x.depth))).toBe(64);
});

// --- objectsHtml (the rendering) exercised through a mock Machine ----------

interface ObjSpec {
  parent?: number;
  child?: number;
  sibling?: number;
  name?: string;
  nameThrows?: boolean;
  attrs?: number[];
  attrsThrows?: boolean;
  props?: { number: number; dataAddress: number; length: number }[];
}

/** A Machine mock covering only what objectsHtml reads. Short names live at a
 *  synthetic address per object: byte there is the name length, the string follows. */
function machineWith(cfg: {
  count?: number;
  countThrows?: boolean;
  objs: Record<number, ObjSpec>;
  bytes?: Record<number, number>;
  words?: Record<number, number>;
  dict?: Record<number, string>;
}): Machine {
  const { objs } = cfg;
  const nameBase = (n: number): number => 10000 + n * 100;
  const byteAt = new Map<number, number>();
  const nameAt = new Map<number, string>();

  for (const [k, o] of Object.entries(objs)) {
    const n = Number(k);
    byteAt.set(nameBase(n), o.name ? 1 : 0); // name length
    if (o.name) nameAt.set(nameBase(n) + 1, o.name);
  }
  for (const [a, v] of Object.entries(cfg.bytes ?? {})) byteAt.set(Number(a), v);
  const get = (n: number): ObjSpec => objs[n] ?? {};

  return {
    readMemoryByte: (a: number): number => byteAt.get(a) ?? 0,
    readMemoryWord: (a: number): number => cfg.words?.[a] ?? 0,
    getDictionaryWord: (w: number): string => cfg.dict?.[w] ?? "",
    text: { decodeAtAddress: (a: number): string => nameAt.get(a) ?? "" },
    objects: {
      getObjectCount: (): number => {
        if (cfg.countThrows) throw new Error("no table");
        return cfg.count ?? Object.keys(objs).length;
      },
      getParent: (n: number): number => get(n).parent ?? 0,
      getChild: (n: number): number => get(n).child ?? 0,
      getSibling: (n: number): number => get(n).sibling ?? 0,
      getShortNameAddress: (n: number): number => {
        if (get(n).nameThrows) throw new Error("bad name");
        return nameBase(n);
      },
      getSetAttributes: (n: number): number[] => {
        if (get(n).attrsThrows) throw new Error("unreadable");
        return get(n).attrs ?? [];
      },
      readProperties: (n: number): ObjSpec["props"] => get(n).props ?? [],
    },
  } as unknown as Machine;
}

test("objectsHtml renders a collapsed row per object with its name", () => {
  const m = machineWith({
    objs: { 1: { parent: 0, child: 2, name: "West of House" }, 2: { parent: 1, name: "mailbox" } },
  });
  const html = objectsHtml(m, new Set());

  expect(html).toContain('data-obj="1"');
  expect(html).toContain("West of House");
  expect(html).toContain('data-obj="2"');
  expect(html).toContain("mailbox");
  expect(html).toContain("▸"); // collapsed chevron
});

test("objectsHtml shows (no name) for a nameless object", () => {
  expect(objectsHtml(machineWith({ objs: { 1: { parent: 0 } } }), new Set())).toContain(
    "(no name)",
  );
});

test("a name that can't be read leaves the row nameless (caught)", () => {
  const m = machineWith({ objs: { 1: { parent: 0, nameThrows: true } } });
  expect(objectsHtml(m, new Set())).toContain("(no name)");
});

test("objectsHtml returns an empty message when there is no object table", () => {
  const m = machineWith({ countThrows: true, objs: {} });
  expect(objectsHtml(m, new Set())).toBe(`<div class="empty">no object table</div>`);
});

test("an expanded object shows its attributes, links, and a byte property as an object ref", () => {
  const m = machineWith({
    count: 2,
    objs: {
      1: {
        parent: 0,
        name: "lamp",
        attrs: [3, 14],
        props: [{ number: 5, dataAddress: 100, length: 1 }],
      },
      2: { parent: 0, name: "brass lantern" },
    },
    bytes: { 100: 2 }, // P5's single byte = object number 2
  });
  const html = objectsHtml(m, new Set([1]));

  expect(html).toContain("▾"); // expanded chevron
  expect(html).toContain("attrs: 3, 14");
  expect(html).toContain("parent 0 · sibling 0 · child 0");
  expect(html).toContain("P5:");
  expect(html).toContain("{brass lantern}"); // byte interpreted as an object ref
});

test("attrs shows 'none' when an object has no set attributes", () => {
  const m = machineWith({ objs: { 1: { parent: 0, name: "x", attrs: [] } } });
  expect(objectsHtml(m, new Set([1]))).toContain("attrs: none");
});

test("property words are read as dictionary ref, then object ref, then signed number", () => {
  const m = machineWith({
    count: 3,
    objs: {
      1: { parent: 0, name: "x", props: [{ number: 7, dataAddress: 200, length: 6 }] },
      2: { parent: 0, name: "troll" },
      3: { parent: 0, name: "y" },
    },
    words: { 200: 0x1234, 202: 2, 204: 0xffff }, // dict word, object 2, -1
    dict: { 0x1234: "sword" },
  });
  const html = objectsHtml(m, new Set([1]));

  expect(html).toContain(`"sword"`); // dictionary ref wins
  expect(html).toContain("{troll}"); // valid object number
  expect(html).toContain("-1"); // otherwise a signed number
});

test("an in-range object number with no short name falls back to a signed number", () => {
  const m = machineWith({
    count: 4,
    objs: {
      1: { parent: 0, name: "x", props: [{ number: 1, dataAddress: 200, length: 2 }] },
      4: { parent: 0 }, // in range, but has no short name
    },
    words: { 200: 4 }, // the property word points at object 4
  });
  const html = objectsHtml(m, new Set([1]));
  expect(html).toContain('class="dim">= 4</span>'); // signed number, not {name}
});

test("a property that isn't a clean word sequence shows no interpretation", () => {
  const m = machineWith({
    objs: {
      1: {
        parent: 0,
        name: "x",
        props: [
          { number: 1, dataAddress: 100, length: 3 }, // odd length
          { number: 2, dataAddress: 110, length: 18 }, // too long
        ],
      },
    },
  });
  const html = objectsHtml(m, new Set([1]));

  expect(html).toContain("P1:");
  expect(html).toContain("P2:");
  expect(html).not.toContain('class="dim">='); // no meaning span for either
});

test("an object whose details throw is marked (unreadable)", () => {
  const m = machineWith({ objs: { 1: { parent: 0, name: "x", attrsThrows: true } } });
  expect(objectsHtml(m, new Set([1]))).toContain("(unreadable)");
});

test("objectsHtml notes how many objects were truncated past the cap", () => {
  const objs: Record<number, ObjSpec> = {};
  for (let n = 1; n <= 1000; n++) objs[n] = { parent: 0 }; // 1000 roots
  const m = machineWith({ count: 1001, objs });
  expect(objectsHtml(m, new Set())).toContain("…and 1 more");
});
