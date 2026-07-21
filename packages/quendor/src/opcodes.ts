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
        `Unknown opcode: kind=${OpcodeKindName[kind]} number=0x${number.toString(16)}`,
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
  Call: 0x10,
  DoubleVar: 0x20,
  FirstOpByRef: 0x40,
  Return: 0x80,
} as const;

// [kind, number, name, flags, fromVersion, toVersion]
type Entry = [OpcodeKind, number, string, number, number, number];

const ENTRIES: Entry[] = [
  //
];

export const isReturn = (o: Opcode): boolean => (o.flags & OpcodeFlags.Return) !== 0;
export const hasZText = (o: Opcode): boolean => (o.flags & OpcodeFlags.ZText) !== 0;
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
