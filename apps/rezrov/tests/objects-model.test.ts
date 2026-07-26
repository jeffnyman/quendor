import { expect, test } from "vite-plus/test";
import { walkObjectTree, type ObjectTree } from "../web/objects-model.ts";

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
