export const OpcodeKind = {
  TwoOp: 0,
  OneOp: 1,
  ZeroOp: 2,
  VarOp: 3,
  Ext: 4,
} as const;

export type OpcodeKind = (typeof OpcodeKind)[keyof typeof OpcodeKind];

/** Reverse lookup (value -> name) for error messages; enums provide this for free. */
const OpcodeKindName: Record<OpcodeKind, string> = {
  [OpcodeKind.TwoOp]: "TwoOp",
  [OpcodeKind.OneOp]: "OneOp",
  [OpcodeKind.ZeroOp]: "ZeroOp",
  [OpcodeKind.VarOp]: "VarOp",
  [OpcodeKind.Ext]: "Ext",
};

export interface Opcode {
  readonly kind: OpcodeKind;
  readonly number: number;
  readonly name: string;
  readonly flags: number;
}

export class OpcodeTable {
  private readonly map = new Map<number, Opcode>();

  private static key(kind: OpcodeKind, number: number): number {
    return kind * 256 + number;
  }

  add(op: Opcode): void {
    this.map.set(OpcodeTable.key(op.kind, op.number), op);
  }

  get(kind: OpcodeKind, number: number): Opcode {
    const op = this.map.get(OpcodeTable.key(kind, number));

    if (op === undefined) {
      throw new Error(
        `Unknown opcode: kind=${OpcodeKindName[kind]} number=0x${number.toString(16).padStart(2, "0")}`,
      );
    }

    return op;
  }
}

export const OpcodeFlags = {
  None: 0x00,
  Store: 0x01,
  Branch: 0x02,
  ZText: 0x04,
  Jump: 0x08,
  Call: 0x10,
  DoubleVar: 0x20,
  FirstOpByRef: 0x40,
  Return: 0x80,
} as const;

// [kind, number, name, flags, fromVersion, toVersion]
type Entry = [OpcodeKind, number, string, number, number, number];
const F = OpcodeFlags;

const ENTRIES: Entry[] = [
  // two-operand opcodes
  [OpcodeKind.TwoOp, 0x01, "je", F.Branch, 1, 8],
  [OpcodeKind.TwoOp, 0x02, "jl", F.Branch, 1, 8],
  [OpcodeKind.TwoOp, 0x03, "jg", F.Branch, 1, 8],
  [OpcodeKind.TwoOp, 0x04, "dec_chk", F.Branch | F.FirstOpByRef, 1, 8],
  [OpcodeKind.TwoOp, 0x05, "inc_chk", F.Branch | F.FirstOpByRef, 1, 8],
  [OpcodeKind.TwoOp, 0x06, "jin", F.Branch, 1, 8],
  [OpcodeKind.TwoOp, 0x07, "test", F.Branch, 1, 8],
  [OpcodeKind.TwoOp, 0x08, "or", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x09, "and", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x0a, "test_attr", F.Branch, 1, 8],
  [OpcodeKind.TwoOp, 0x0b, "set_attr", F.None, 1, 8],
  [OpcodeKind.TwoOp, 0x0c, "clear_attr", F.None, 1, 8],
  [OpcodeKind.TwoOp, 0x0d, "store", F.FirstOpByRef, 1, 8],
  [OpcodeKind.TwoOp, 0x0e, "insert_obj", F.None, 1, 8],
  [OpcodeKind.TwoOp, 0x0f, "loadw", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x10, "loadb", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x11, "get_prop", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x12, "get_prop_addr", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x13, "get_next_prop", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x14, "add", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x15, "sub", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x16, "mul", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x17, "div", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x18, "mod", F.Store, 1, 8],
  [OpcodeKind.TwoOp, 0x19, "call_2s", F.Call | F.Store, 4, 8],

  // one-operand opcodes
  [OpcodeKind.OneOp, 0x00, "jz", F.Branch, 1, 8],
  [OpcodeKind.OneOp, 0x01, "get_sibling", F.Store | F.Branch, 1, 8],
  [OpcodeKind.OneOp, 0x02, "get_child", F.Store | F.Branch, 1, 8],
  [OpcodeKind.OneOp, 0x03, "get_parent", F.Store, 1, 8],
  [OpcodeKind.OneOp, 0x04, "get_prop_len", F.Store, 1, 8],
  [OpcodeKind.OneOp, 0x05, "inc", F.FirstOpByRef, 1, 8],
  [OpcodeKind.OneOp, 0x06, "dec", F.FirstOpByRef, 1, 8],
  [OpcodeKind.OneOp, 0x07, "print_addr", F.None, 1, 8],
  [OpcodeKind.OneOp, 0x08, "call_1s", F.Call | F.Store, 4, 8],
  [OpcodeKind.OneOp, 0x09, "remove_obj", F.None, 1, 8],
  [OpcodeKind.OneOp, 0x0a, "print_obj", F.None, 1, 8],
  [OpcodeKind.OneOp, 0x0b, "ret", F.Return, 1, 8],
  [OpcodeKind.OneOp, 0x0c, "jump", F.Jump, 1, 8],
  [OpcodeKind.OneOp, 0x0d, "print_paddr", F.None, 1, 8],
  [OpcodeKind.OneOp, 0x0e, "load", F.FirstOpByRef | F.Store, 1, 8],
  [OpcodeKind.OneOp, 0x0f, "not", F.Store, 1, 4],

  // zero-operand opcodes
  [OpcodeKind.ZeroOp, 0x00, "rtrue", F.Return, 1, 8],
  [OpcodeKind.ZeroOp, 0x01, "rfalse", F.Return, 1, 8],
  [OpcodeKind.ZeroOp, 0x02, "print", F.ZText, 1, 8],
  [OpcodeKind.ZeroOp, 0x03, "print_ret", F.Return | F.ZText, 1, 8],
  [OpcodeKind.ZeroOp, 0x05, "save", F.Branch, 1, 3],
  [OpcodeKind.ZeroOp, 0x06, "restore", F.Branch, 1, 3],
  [OpcodeKind.ZeroOp, 0x07, "restart", F.None, 1, 8],
  [OpcodeKind.ZeroOp, 0x08, "ret_popped", F.Return, 1, 8],
  [OpcodeKind.ZeroOp, 0x09, "pop", F.None, 1, 4],
  [OpcodeKind.ZeroOp, 0x0a, "quit", F.None, 1, 8],
  [OpcodeKind.ZeroOp, 0x0b, "new_line", F.None, 1, 8],
  [OpcodeKind.ZeroOp, 0x0d, "verify", F.Branch, 3, 8],

  // variable-operand opcodes
  [OpcodeKind.VarOp, 0x00, "call", F.Call | F.Store, 1, 4],
  [OpcodeKind.VarOp, 0x01, "storew", F.None, 1, 8],
  [OpcodeKind.VarOp, 0x02, "storeb", F.None, 1, 8],
  [OpcodeKind.VarOp, 0x03, "put_prop", F.None, 1, 8],
  [OpcodeKind.VarOp, 0x04, "sread", F.None, 1, 4],
  [OpcodeKind.VarOp, 0x05, "print_char", F.None, 1, 8],
  [OpcodeKind.VarOp, 0x06, "print_num", F.None, 1, 8],
  [OpcodeKind.VarOp, 0x07, "random", F.Store, 1, 8],
  [OpcodeKind.VarOp, 0x08, "push", F.None, 1, 8],
  [OpcodeKind.VarOp, 0x09, "pull", F.FirstOpByRef, 1, 5],
  [OpcodeKind.VarOp, 0x0c, "call_vs2", F.Call | F.Store | F.DoubleVar, 4, 8],
];

export const isReturn = (o: Opcode): boolean => (o.flags & OpcodeFlags.Return) !== 0;
export const hasZText = (o: Opcode): boolean => (o.flags & OpcodeFlags.ZText) !== 0;
export const isJump = (o: Opcode): boolean => (o.flags & OpcodeFlags.Jump) !== 0;
export const isCall = (o: Opcode): boolean => (o.flags & OpcodeFlags.Call) !== 0;
export const isDoubleVar = (o: Opcode): boolean => (o.flags & OpcodeFlags.DoubleVar) !== 0;
export const hasStore = (o: Opcode): boolean => (o.flags & OpcodeFlags.Store) !== 0;
export const hasBranch = (o: Opcode): boolean => (o.flags & OpcodeFlags.Branch) !== 0;

export function opcodeTableForVersion(version: number): OpcodeTable {
  const index = version - 1;

  if (index < 0 || index >= tables.length) {
    throw new Error(`No opcode table for version ${version}`);
  }

  return tables[index];
}

const tables: OpcodeTable[] = (() => {
  const built = Array.from({ length: 8 }, () => new OpcodeTable());

  for (const [kind, number, name, flags, fromV, toV] of ENTRIES) {
    for (let v = fromV; v <= toV; v++) {
      built[v - 1].add({ kind, number, name, flags });
    }
  }

  return built;
})();
