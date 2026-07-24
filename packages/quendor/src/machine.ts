import type { ZText } from "./text.ts";
import { HeaderOffset, unpackRoutineAddress, unpackString } from "./header.ts";
import { InstructionReader, OperandKind, type Instruction } from "./instruction.ts";
import type { Memory } from "./memory.ts";
import type { Story } from "./story.ts";
import { ObjectTable } from "./objects.ts";
import { decodeQuetzal, encodeQuetzal } from "./quetzal.ts";

/** The execution status of the machine, as seen by a debugger driver. */
export const RunState = {
  /** Ready to execute the next instruction. */
  Running: "running",
  /** Stopped permanently (quit, or returned from the main routine). */
  Halted: "halted",
  /** Blocked on a read opcode; call `provideInput` to continue. */
  WaitingForInput: "waiting-input",
  /** Stopped at a breakpoint; call `run`/`step` to continue. */
  Paused: "paused",
} as const;

export type RunState = (typeof RunState)[keyof typeof RunState];

export interface StepResult {
  /** The instruction that just executed. */
  executed: Instruction;
  /** The machine's state after the step. */
  state: RunState;
}

export interface Frame {
  /** Address of the routine header this frame is executing (0 for main). */
  routineAddress: number;
  locals: number[];
  argumentCount: number;
  /** Store variable number, or -1 if the call discards its result. */
  storeVariable: number;
  returnPC: number;
  /** Index into the value stack at which this frame's evaluation stack begins. */
  stackBase: number;
}

const toS16 = (x: number): number => {
  x &= 0xffff;
  return x >= 0x8000 ? x - 0x10000 : x;
};

export class Machine {
  readonly memory: Memory;
  readonly version: number;
  readonly text: ZText;
  readonly objects: ObjectTable;

  /** Header interpreter number (0x1e) — defaults to 6 (IBM PC). */
  readonly interpreterNumber: number;
  /** Header interpreter version letter (0x1f) — defaults to 'A'. */
  readonly interpreterVersion: number;

  private readonly globalsAddress: number;
  private readonly routinesOffset: number;
  private readonly stringsOffset: number;
  private readonly initialProgramCounter: number;
  private readonly dictionaryAddress: number;
  private readonly headerChecksum: number;
  private readonly computedChecksum: number;

  private pc = 0;
  private readonly stack: number[] = [];
  private readonly frames: Frame[] = [];
  private current: Frame;
  private instructionCount = 0;
  private currentInstruction!: Instruction;
  private ops: number[] = [];

  private readonly staticBase: number;
  private readonly originalDynamic: Uint8Array;

  // output stream 3 (memory) redirection stack
  private memoryStreams: { address: number; count: number }[] = [];

  private runState: RunState = RunState.Running;

  private readonly inputQueue: string[] = [];

  // For read_char: a typed line is fed one character at a time
  // (with a trailing Enter) so keystroke-driven UIs (menus,
  // forms) work with line input.
  private charBuffer: string[] = [];
  private pendingRead: {
    kind: "sread" | "aread" | "read_char";
    textBuffer: number;
    parseBuffer: number;
    storeVariable: number;
  } | null = null;

  /** Breakpoints, keyed by instruction address. */
  private skipBreakpointOnce = false;
  readonly breakpoints = new Set<number>();

  // Data watchpoints: break when a watched byte's value changes.
  private watchTriggered = false;

  private rngState = 1;
  /** The seed governing all randomness (for reproducible playthroughs). */
  readonly randomSeed: number;

  /** Whether to set the v1-3 "Tandy" header bit (Flags 1, bit 3). */
  private readonly tandy: boolean;

  constructor(story: Story, options: { randomSeed?: number; tandy?: boolean } = {}) {
    this.memory = story.memory;
    this.version = story.header.version;
    this.text = story.text;
    this.initialProgramCounter = story.header.initialProgramCounter;

    this.interpreterNumber = 6; // IBM PC
    this.interpreterVersion = 0x41; // 'A'
    this.routinesOffset = story.header.routinesOffset;
    this.stringsOffset = story.header.stringsOffset;
    this.globalsAddress = story.header.globalVariablesTableAddress;
    this.dictionaryAddress = story.header.dictionaryAddress;
    this.headerChecksum = story.header.checksum;
    this.computedChecksum = story.computedChecksum();

    this.objects = new ObjectTable(this.memory, this.version, story.header.objectTableAddress);

    // Snapshot pristine dynamic memory before we mutate any header bytes.
    this.staticBase = this.memory.readWord(0x0e);
    this.originalDynamic = this.memory.bytes.slice(0, this.staticBase);

    // Default seed 1 keeps runs reproducible; --seed (or any consumer) overrides it.
    this.randomSeed = (options.randomSeed ?? 1) >>> 0 || 1;
    this.rngState = this.randomSeed;

    this.tandy = options.tandy ?? false;

    this.setupHeaderCapabilities();
    this.current = this.setupInitialFrame(this.initialProgramCounter);
  }

  /** The call frame currently executing. */
  get currentFrame(): Frame {
    return this.current;
  }

  onOutput: (text: string) => void = () => {};

  /** Called when a routine returns. */
  onExitFrame: (returnPC: number) => void = () => {};

  /**
   * Trace hook: fired for every instruction just before it executes, with the
   * current call depth (main routine = 1) and its resolved operand values.
   * Powers the CLI's `--trace` execution logger; a no-op (negligible) by default.
   */
  onTrace: (insn: Instruction, depth: number, ops: number[]) => void = () => {};

  /** Called when a routine is entered (call). */
  onEnterFrame: (routineAddress: number, returnPC: number) => void = () => {};

  /** Persist a Quetzal save blob; return true on success. */
  onSave: (data: Uint8Array) => boolean = () => false;

  /** Supply a Quetzal save blob to restore, or null if none/cancelled. */
  onRestore: () => Uint8Array | null = () => null;

  /**
   * Run until the machine halts, blocks on input, or hits a breakpoint.
   * Returns the resulting state. Safe to call again to resume from Paused.
   */
  run(maxInstructions = 100_000_000): RunState {
    if (this.runState === RunState.Halted) {
      return this.runState;
    }

    if (this.runState === RunState.Paused) {
      // resuming: don't immediately re-break on the same address
      this.skipBreakpointOnce = true;
    }

    this.runState = RunState.Running;

    let steps = 0;

    while ((this.runState as RunState) === RunState.Running) {
      if (!this.skipBreakpointOnce && this.breakpoints.size > 0 && this.breakpoints.has(this.pc)) {
        this.runState = RunState.Paused;
        return this.runState;
      }

      this.skipBreakpointOnce = false;

      this.stepInternal();

      if (this.watchTriggered && (this.runState as RunState) === RunState.Running) {
        // stopped just after a watched write
        this.runState = RunState.Paused;
        return this.runState;
      }

      if (++steps > maxInstructions) {
        throw new Error("instruction limit exceeded (possible infinite loop)");
      }
    }

    return this.runState;
  }

  /** Provide a line of input to satisfy a pending read, or queue it. */
  provideInput(line: string): void {
    if (this.pendingRead?.kind === "read_char") {
      // Feed the line to read_char one character at a time (trailing Enter).
      this.charBuffer = Array.from(line + "\r");

      const storeVariable = this.pendingRead.storeVariable;

      this.pendingRead = null;
      this.storeCharCode(this.charBuffer.shift() as string, storeVariable);

      if (this.runState === RunState.WaitingForInput) {
        this.runState = RunState.Running;
      }
    } else if (this.pendingRead) {
      this.completeRead(this.pendingRead, line);
      this.pendingRead = null;

      if (this.runState === RunState.WaitingForInput) {
        this.runState = RunState.Running;
      }
    } else {
      this.inputQueue.push(line);
    }
  }

  /**
   * Execute a single instruction and return what happened. Valid when the
   * machine is Running or Paused (single-stepping past a breakpoint). A read
   * opcode with no queued input leaves the machine WaitingForInput.
   */
  step(): StepResult {
    if (this.runState === RunState.Halted) {
      throw new Error("cannot step: machine has halted");
    }

    if (this.runState === RunState.WaitingForInput) {
      throw new Error("cannot step: waiting for input (call provideInput)");
    }

    this.runState = RunState.Running;

    const executed = this.stepInternal();

    return { executed, state: this.runState };
  }

  private execute(name: string): void {
    const o = this.ops;

    switch (name) {
      // --- arithmetic ---
      case "add":
        return this.store((toS16(o[0]) + toS16(o[1])) & 0xffff);
      case "sub":
        return this.store((toS16(o[0]) - toS16(o[1])) & 0xffff);
      case "mul":
        return this.store((toS16(o[0]) * toS16(o[1])) & 0xffff);
      case "div":
        return this.store(Math.trunc(toS16(o[0]) / toS16(o[1])) & 0xffff);
      case "mod":
        return this.store((toS16(o[0]) % toS16(o[1])) & 0xffff);

      // --- bitwise ---
      case "and":
        return this.store(o[0] & o[1]);
      case "or":
        return this.store(o[0] | o[1]);
      case "not":
        return this.store(~o[0] & 0xffff);
      case "test":
        return this.branchOn((o[0] & o[1]) === o[1]);

      // --- inc / dec ---
      case "inc":
        this.incDec(o[0], +1);
        return;
      case "dec":
        this.incDec(o[0], -1);
        return;
      case "inc_chk": {
        const v = this.incDec(o[0], +1);
        return this.branchOn(v > toS16(o[1]));
      }
      case "dec_chk": {
        const v = this.incDec(o[0], -1);
        return this.branchOn(v < toS16(o[1]));
      }

      // --- jumps ---
      case "je": {
        let eq = false;

        for (let i = 1; i < o.length; i++) {
          if (o[0] === o[i]) eq = true;
        }

        return this.branchOn(eq);
      }
      case "jl":
        return this.branchOn(toS16(o[0]) < toS16(o[1]));
      case "jg":
        return this.branchOn(toS16(o[0]) > toS16(o[1]));
      case "jz":
        return this.branchOn(o[0] === 0);
      case "jin": {
        if (o[0] === 0) return this.branchOn(o[1] === 0);
        return this.branchOn(this.objects.getParent(o[0]) === o[1]);
      }
      case "jump": {
        // PC is a full address (can exceed 0xffff in large stories) — no mask.
        this.pc = this.pc + toS16(o[0]) - 2;
        return;
      }

      // --- calls / returns ---
      case "call":
        return this.call(o[0], o.slice(1), this.currentInstruction.storeVariable ?? -1);
      case "ret":
        return this.return_(o[0]);
      case "rtrue":
        return this.return_(1);
      case "rfalse":
        return this.return_(0);
      case "ret_popped":
        return this.return_(this.readVariable(0));

      // --- load / store / memory ---
      case "load":
        return this.store(this.readVariableIndirect(o[0]));
      case "store":
        return this.writeVariableIndirect(o[0], o[1]);
      case "loadw":
        return this.store(this.memory.readWord((o[0] + o[1] * 2) & 0xffff));
      case "loadb":
        return this.store(this.memory.readByte((o[0] + o[1]) & 0xffff));
      case "storew":
        return this.memory.writeWord((o[0] + o[1] * 2) & 0xffff, o[2]);
      case "storeb":
        return this.memory.writeByte((o[0] + o[1]) & 0xffff, o[2]);
      case "push":
        return this.writeVariable(0, o[0]);
      case "pull":
        return this.writeVariableIndirect(o[0], this.readVariable(0));
      case "pop":
        this.readVariable(0);
        // discard top of stack (v1-4)
        return;

      // --- objects ---
      case "get_parent":
        return this.store(o[0] === 0 ? 0 : this.objects.getParent(o[0]));
      case "get_sibling": {
        const s = o[0] === 0 ? 0 : this.objects.getSibling(o[0]);
        this.store(s);
        return this.branchOn(s > 0);
      }
      case "get_child": {
        const c = o[0] === 0 ? 0 : this.objects.getChild(o[0]);
        this.store(c);
        return this.branchOn(c > 0);
      }
      case "test_attr":
        return this.branchOn(o[0] !== 0 && this.objects.hasAttribute(o[0], o[1]));
      case "set_attr":
        if (o[0] !== 0) this.objects.setAttribute(o[0], o[1], true);
        return;
      case "clear_attr":
        if (o[0] !== 0) this.objects.setAttribute(o[0], o[1], false);
        return;
      case "insert_obj":
        if (o[0] !== 0 && o[1] !== 0) this.objects.moveObject(o[0], o[1]);
        return;
      case "remove_obj":
        if (o[0] !== 0) this.objects.removeObject(o[0]);
        return;
      case "get_prop":
        return this.store(this.getProp(o[0], o[1]));
      case "get_prop_addr":
        return this.store(this.getPropAddr(o[0], o[1]));
      case "get_prop_len":
        return this.store(this.getPropLen(o[0]));
      case "get_next_prop":
        return this.store(this.getNextProp(o[0], o[1]));
      case "put_prop":
        return this.putProp(o[0], o[1], o[2]);

      // --- output ---
      case "print":
        return this.print(this.decodeInline());
      case "print_ret":
        this.print(this.decodeInline() + "\n");
        return this.return_(1);
      case "new_line":
        return this.print("\n");
      case "print_char":
        return this.print(String.fromCharCode(o[0]));
      case "print_num":
        return this.print(String(toS16(o[0])));
      case "print_obj":
        return this.print(this.text.decodeAtAddress(this.objects.getShortNameAddress(o[0]) + 1));
      case "print_addr":
        return this.print(this.text.decodeAtAddress(o[0]));
      case "print_paddr":
        return this.print(
          this.text.decodeAtAddress(unpackString(this.version, o[0], this.stringsOffset)),
        );

      // --- input ---
      case "sread":
        return this.sread(o);

      // --- game state ---
      case "random":
        return this.random(toS16(o[0]));
      case "verify":
        return this.branchOn(this.computedChecksum === this.headerChecksum);
      case "quit":
        this.runState = RunState.Halted;
        return;
      case "restart":
        return this.doRestart();
      case "save":
        return this.doSave();
      case "restore":
        return this.doRestore();

      default:
        throw new Error(
          `unimplemented opcode '${name}' at 0x${this.currentInstruction.address.toString(16)}` +
            ` (operands: ${o.map((v) => "0x" + v.toString(16).padStart(4, "0")).join(", ")})`,
        );
    }
  }

  private beginRead(
    kind: "sread" | "aread",
    textBuffer: number,
    parseBuffer: number,
    storeVariable: number,
  ): void {
    const request = { kind, textBuffer, parseBuffer, storeVariable };
    const queued = this.inputQueue.shift();

    if (queued !== undefined) {
      this.completeRead(request, queued);
    } else {
      this.pendingRead = request;
      this.runState = RunState.WaitingForInput;
    }
  }

  private sread(o: number[]): void {
    if (this.version <= 3) this.showStatus(); // v1-3 refresh the status bar
    this.beginRead("sread", o[0], o[1], -1);
  }

  /** Draw the v1-3 status bar from globals 0 (location), 1 and 2 (score/time). */
  private showStatus(): void {
    if (this.version > 3) return;

    // NOTE: NEED TO IMPLEMENT SCREEN TO MAKE THIS WORK
  }

  private call(packedAddress: number, args: number[], storeVariable: number): void {
    if (packedAddress === 0) {
      // Calling packed routine 0 does nothing and yields false. (Test the
      // packed address, not the unpacked one: in v6 unpackRoutine(0) is the
      // nonzero routines offset, so an unpacked check would miss this.)
      if (storeVariable >= 0) this.writeVariable(storeVariable, 0);
      return;
    }

    const address = unpackRoutineAddress(this.version, packedAddress, this.routinesOffset);
    const returnPC = this.pc;

    this.pc = address;

    const frame = this.enterRoutineHeader(address, args, storeVariable, returnPC);

    this.frames.push(frame);
    this.current = frame;
    this.onEnterFrame(address, returnPC);
  }

  private store(value: number): void {
    const variable = this.currentInstruction.storeVariable;

    if (variable === undefined) {
      throw new Error(`store from a non-storing opcode '${this.currentInstruction.opcode.name}'`);
    }

    this.writeVariable(variable, value & 0xffff);
  }

  private print(text: string): void {
    if (this.memoryStreams.length > 0) {
      // Stream 3 (memory) captures output and suppresses the screen entirely.
      const stream = this.memoryStreams[this.memoryStreams.length - 1];

      for (let i = 0; i < text.length; i++) {
        this.memory.writeByte(stream.address + 2 + stream.count, text.charCodeAt(i));
        stream.count++;
      }

      return;
    }

    this.onOutput(text);
  }

  private putProp(objNum: number, propNum: number, value: number): void {
    if (objNum === 0) return;
    const { address, sizeByte, found } = this.findProp(objNum, propNum);

    if (!found) {
      throw new Error("put_prop: property not found");
    }

    const dataAddress = address + 1;
    const oneByte = this.version <= 3 ? (sizeByte & 0xe0) === 0 : (sizeByte & 0xc0) === 0;

    if (oneByte) {
      this.memory.writeByte(dataAddress, value & 0xff);
    } else {
      this.memory.writeWord(dataAddress, value);
    }
  }

  private getProp(objNum: number, propNum: number): number {
    if (objNum === 0) return 0;

    const { address, sizeByte, found } = this.findProp(objNum, propNum);

    if (!found) return this.objects.readPropertyDefault(propNum);

    const dataAddress = address + 1;
    const oneByte = this.version <= 3 ? (sizeByte & 0xe0) === 0 : (sizeByte & 0xc0) === 0;

    return oneByte ? this.memory.readByte(dataAddress) : this.memory.readWord(dataAddress);
  }

  private getNextProp(objNum: number, propNum: number): number {
    if (objNum === 0) return 0;

    const mask = this.version <= 3 ? 0x1f : 0x3f;
    let address = this.objects.getFirstPropertyAddress(objNum);

    if (propNum !== 0) {
      let value: number;

      do {
        value = this.memory.readByte(address);
        address = this.objects.getNextPropertyAddress(address);
      } while ((value & mask) > propNum);

      if ((value & mask) !== propNum) throw new Error("get_next_prop: not found");
    }

    return this.memory.readByte(address) & mask;
  }

  private getPropAddr(objNum: number, propNum: number): number {
    if (objNum === 0) return 0;

    const { address, sizeByte, found } = this.findProp(objNum, propNum);

    if (!found) return 0;

    let dataAddress = address;

    if (this.version >= 4 && (sizeByte & 0x80) !== 0) dataAddress++;

    return dataAddress + 1;
  }

  private getPropLen(dataAddress: number): number {
    if (dataAddress === 0) return 0;

    let value = this.memory.readByte(dataAddress - 1);

    if (this.version <= 3) {
      value = (value >> 5) + 1;
    } else if ((value & 0x80) === 0) {
      value = (value >> 6) + 1;
    } else {
      value &= 0x3f;
    }

    return value === 0 ? 64 : value;
  }

  private findProp(
    objNum: number,
    propNum: number,
  ): { address: number; sizeByte: number; found: boolean } {
    let address = this.objects.getFirstPropertyAddress(objNum);
    const mask = this.version <= 3 ? 0x1f : 0x3f;

    for (;;) {
      const sizeByte = this.memory.readByte(address);

      if ((sizeByte & mask) <= propNum) {
        return { address, sizeByte, found: (sizeByte & mask) === propNum };
      }

      address = this.objects.getNextPropertyAddress(address);
    }
  }

  private branchOn(condition: boolean): void {
    const b = this.currentInstruction.branch;

    if (b === undefined) {
      throw new Error(`branch on a non-branching opcode '${this.currentInstruction.opcode.name}'`);
    }

    if (condition !== b.whenTrue) return;

    if (b.offset === 0) {
      this.return_(0);
    } else if (b.offset === 1) {
      this.return_(1);
    } else {
      if (b.targetAddress === undefined) {
        throw new Error("branch offset with no resolved target address");
      }

      this.pc = b.targetAddress;
    }
  }

  private return_(value: number): void {
    const frame = this.frames.pop();

    if (frame === undefined) {
      throw new Error("return with no active call frame");
    }

    // discard this frame's evaluation stack
    this.stack.length = frame.stackBase;
    this.pc = frame.returnPC;

    if (this.frames.length === 0) {
      // returned out of the main routine
      this.runState = RunState.Halted;
      return;
    }

    this.current = this.frames[this.frames.length - 1];

    if (frame.storeVariable >= 0) {
      this.writeVariable(frame.storeVariable, value);
    }

    this.onExitFrame(frame.returnPC);
  }

  private incDec(varNum: number, delta: number): number {
    const v = (toS16(this.readVariableIndirect(varNum)) + delta) & 0xffff;

    this.writeVariableIndirect(varNum, v);

    return toS16(v);
  }

  private decodeInline(): string {
    const zwords = this.currentInstruction.zwords;

    if (zwords === undefined) {
      throw new Error(
        `decodeInline on an opcode without inline text '${this.currentInstruction.opcode.name}'`,
      );
    }

    return this.text.decode([...zwords], {
      allowAbbreviations: true,
      allowIncompleteMultibyte: true,
    });
  }

  private stepInternal(): Instruction {
    this.watchTriggered = false;

    const reader = new InstructionReader(this.memory, this.version, this.pc);
    const insn = reader.next();

    this.pc = reader.address;
    this.currentInstruction = insn;

    // Resolve operand values in order (variable operands may pop the stack).
    const ops: number[] = [];

    for (const operand of insn.operands) {
      ops.push(
        operand.kind === OperandKind.Variable ? this.readVariable(operand.value) : operand.value,
      );
    }

    this.ops = ops;

    this.onTrace(insn, this.frames.length, ops);
    this.execute(insn.opcode.name);
    this.instructionCount++;

    return insn;
  }

  private completeRead(
    request: {
      kind: "sread" | "aread" | "read_char";
      textBuffer: number;
      parseBuffer: number;
      storeVariable: number;
    },
    line: string,
  ): void {
    const { kind, textBuffer, parseBuffer, storeVariable } = request;
    const maxChars = this.memory.readByte(textBuffer);
    let text = line.toLowerCase();

    if (text.length > maxChars) {
      text = text.slice(0, maxChars);
    }

    if (kind === "sread") {
      // v1-4: NUL-terminated text buffer; parse offsets are 1-based.
      for (let i = 0; i < text.length; i++) {
        this.memory.writeByte(textBuffer + 1 + i, text.charCodeAt(i));
      }

      this.memory.writeByte(textBuffer + 1 + text.length, 0);

      if (parseBuffer > 0) {
        this.tokenizeInto(text, parseBuffer, 1);
      }
    } else {
      // v5+: length-prefixed text buffer; parse offsets are 2-based.
      this.memory.writeByte(textBuffer + 1, text.length);

      for (let i = 0; i < text.length; i++) {
        this.memory.writeByte(textBuffer + 2 + i, text.charCodeAt(i));
      }

      if (parseBuffer > 0) {
        this.tokenizeInto(text, parseBuffer, 2);
      }

      if (storeVariable >= 0) {
        this.writeVariable(storeVariable, 10); // newline
      }
    }
  }

  /** Tokenize `text` into the parse buffer; `textStartOffset` is 1 (v3) or 2 (v5). */
  private tokenizeInto(
    text: string,
    parseBuffer: number,
    textStartOffset: number,
    dictionary?: number,
    skipUnknown = false,
  ): void {
    const dict = dictionary && dictionary !== 0 ? dictionary : this.dictionaryAddress;
    const tokens = this.text.tokenizeCommand(text, dict);
    const maxWords = this.memory.readByte(parseBuffer);
    const parsed = Math.min(maxWords, tokens.length);

    this.memory.writeByte(parseBuffer + 1, parsed);

    for (let i = 0; i < parsed; i++) {
      const token = tokens[i];
      const entry = this.text.lookupWord(token.text, dict);

      // tokenise's `flag`: when set, a word not found in *this* dictionary is
      // left unchanged in the parse buffer, so an earlier pass (e.g. the default
      // dictionary) survives. Games like Beyond Zork parse against several
      // dictionaries this way; clobbering with 0 breaks every standard verb.
      if (entry === 0 && skipUnknown) continue;

      const base = parseBuffer + 2 + i * 4;

      this.memory.writeWord(base, entry > 0 ? entry : 0);
      this.memory.writeByte(base + 2, token.length);
      this.memory.writeByte(base + 3, token.start + textStartOffset);
    }
  }

  private storeCharCode(ch: string, storeVariable: number): void {
    if (storeVariable >= 0) {
      this.writeVariable(storeVariable, ch === "\r" ? 13 : ch.charCodeAt(0));
    }
  }

  private readVariable(n: number): number {
    if (n === 0) {
      if (this.stack.length <= this.current.stackBase) {
        throw new Error("stack underflow");
      }

      return this.stack.pop() as number;
    }

    if (n < 0x10) {
      return this.current.locals[n - 1];
    }

    return this.memory.readWord(this.globalsAddress + (n - 0x10) * 2);
  }

  private readVariableIndirect(n: number): number {
    if (n === 0) {
      if (this.stack.length <= this.current.stackBase) {
        throw new Error("stack underflow");
      }

      return this.stack[this.stack.length - 1];
    }
    if (n < 0x10) {
      return this.current.locals[n - 1];
    }

    return this.memory.readWord(this.globalsAddress + (n - 0x10) * 2);
  }

  private writeVariable(n: number, value: number): void {
    value &= 0xffff;

    if (n === 0) {
      this.stack.push(value);
    } else if (n < 0x10) {
      this.current.locals[n - 1] = value;
    } else {
      this.memory.writeWord(this.globalsAddress + (n - 0x10) * 2, value);
    }
  }

  private writeVariableIndirect(n: number, value: number): void {
    value &= 0xffff;

    if (n === 0) {
      if (this.stack.length <= this.current.stackBase) {
        throw new Error("stack underflow");
      }

      this.stack[this.stack.length - 1] = value;
    } else if (n < 0x10) {
      this.current.locals[n - 1] = value;
    } else {
      this.memory.writeWord(this.globalsAddress + (n - 0x10) * 2, value);
    }
  }

  private setupHeaderCapabilities(): void {
    this.memory.writeByte(HeaderOffset.InterpreterNumber, this.interpreterNumber);
    this.memory.writeByte(HeaderOffset.InterpreterVersion, this.interpreterVersion);

    // The "Tandy" flag (Flags 1 bit 3). Some games (e.g. The Witness) produce
    // cleaner, less-offensive prose when it's set. (In v4+ this bit means
    // "italic available" instead, so it's only set for v1-3.) The interpreter
    // owns this bit, so setting it here means it survives restart/restore
    // (both re-run this method).
    if (this.version <= 3) {
      const flags1 = this.memory.readByte(HeaderOffset.Flags1);

      this.memory.writeByte(HeaderOffset.Flags1, this.tandy ? flags1 | 0x08 : flags1 & 0xf7);
    }
  }

  private setupInitialFrame(initialPC: number): Frame {
    // §5.4: In v6, the word at $06 is the packed address of a real
    // "main" routine, called like any other; it has a genuine header.
    if (this.version === 6) {
      const routineAddress = unpackRoutineAddress(this.version, initialPC, this.routinesOffset);

      this.pc = routineAddress;

      const frame = this.enterRoutineHeader(routineAddress, [], -1, 0);

      this.frames.push(frame);

      return frame;
    }

    // §5.5: In all other versions, $06 is the byte address of the
    // first instruction directly; no header, no locals to read.
    this.pc = initialPC;

    const frame: Frame = {
      routineAddress: initialPC,
      locals: [],
      argumentCount: 0,
      storeVariable: -1,
      returnPC: 0,
      stackBase: this.stack.length,
    };

    this.frames.push(frame);

    return frame;
  }

  /**
   * Read a routine header at `pc`, build a frame, and advance
   * pc past it.
   */
  private enterRoutineHeader(
    routineAddress: number,
    args: number[],
    storeVariable: number,
    returnPC: number,
  ): Frame {
    // §5.2: A routine begins with one byte indicating the number of
    // local variables it has (between 0 and 15 inclusive).
    const localCount = this.memory.readByte(this.pc++);

    // §5.2.1: In Versions 1 to 4, that number of 2-byte words
    // follows, giving initial values for these local variables. In
    // Versions 5 and later, the initial values are all zero.
    const locals: number[] = Array.from({ length: localCount }, () => 0);

    for (let i = 0; i < localCount; i++) {
      if (this.version <= 4) {
        locals[i] = this.memory.readWord(this.pc);
        this.pc += 2;
      }
    }

    const count = Math.min(args.length, localCount);

    for (let i = 0; i < count; i++) {
      locals[i] = args[i] & 0xffff;
    }

    return {
      routineAddress,
      locals,
      argumentCount: args.length,
      storeVariable,
      returnPC,
      stackBase: this.stack.length,
    };
  }

  /**
   * restart: reset dynamic memory and machine state to the initial load.
   * restart has no store/branch and doesn't return; execution resumes at
   * the initial PC (already set by setupInitialFrame).
   */
  private doRestart(): void {
    this.memory.bytes.set(this.originalDynamic, 0);
    // Rst: re-establish interpreter header fields
    this.setupHeaderCapabilities();
    this.stack.length = 0;
    this.frames.length = 0;
    // keep restarts reproducible
    this.rngState = this.randomSeed;
    this.memoryStreams.length = 0;
    this.charBuffer.length = 0;
    this.pendingRead = null;
    this.current = this.setupInitialFrame(this.initialProgramCounter);
  }

  private seed(value: number): void {
    this.rngState = value >>> 0 || 1;
  }

  private nextRandom(range: number): number {
    // Simple deterministic LCG; adequate for range output and reproducible
    // when re-seeded with the same value.
    this.rngState = (Math.imul(this.rngState, 1103515245) + 12345) & 0x7fffffff;
    return (this.rngState % range) + 1;
  }

  private random(range: number): void {
    if (range > 0) {
      this.store(this.nextRandom(range));
    } else if (range < 0) {
      this.seed(-range);
      this.store(0);
    } else {
      // range == 0: the game asks to re-seed with fresh entropy.
      // For a reproducible interpreter this will re-seed from the
      // configured seed instead.
      this.seed(this.randomSeed);
      this.store(0);
    }
  }

  /** Address of the save/restore result operand (branch bytes v1-3,store byte v4+). */
  private resultOperandAddr(): number {
    const insn = this.currentInstruction;
    return this.version <= 3 ? insn.address + 1 : insn.address + insn.length - 1;
  }

  private serialNumber(): string {
    let s = "";

    for (let i = 0; i < 6; i++) {
      s += String.fromCharCode(this.memory.readByte(0x12 + i));
    }

    return s;
  }

  private doSave(): void {
    const operandAddr = this.resultOperandAddr();
    const frames = this.frames.map((f, i) => ({
      returnPC: f.returnPC,
      locals: f.locals.slice(),
      storeVariable: f.storeVariable,
      argumentCount: f.argumentCount,
      evalStack: this.stack.slice(f.stackBase, this.frames[i + 1]?.stackBase ?? this.stack.length),
    }));
    let ok = false;

    try {
      const blob = encodeQuetzal(
        {
          release: this.memory.readWord(0x02),
          serial: this.serialNumber(),
          checksum: this.headerChecksum,
          pc: operandAddr,
          dynamicMemory: this.memory.bytes.slice(0, this.staticBase),
          frames,
        },
        this.originalDynamic,
      );
      ok = this.onSave(blob);
    } catch {
      ok = false;
    }

    this.applyResult(operandAddr, ok ? 1 : 0);
  }

  private doRestore(): void {
    const currentOperand = this.resultOperandAddr();
    let blob: Uint8Array | null = null;

    try {
      blob = this.onRestore();
    } catch {
      blob = null;
    }

    if (!blob) {
      return this.applyResult(currentOperand, 0);
    }

    let parsed;

    try {
      parsed = decodeQuetzal(blob, this.originalDynamic, this.staticBase);
    } catch {
      return this.applyResult(currentOperand, 0);
    }

    // Reject a save that doesn't belong to this story.
    if (
      parsed.release !== this.memory.readWord(0x02) ||
      parsed.serial !== this.serialNumber() ||
      parsed.checksum !== this.headerChecksum
    ) {
      return this.applyResult(currentOperand, 0);
    }

    // Restore dynamic memory (bytes.set bypasses watchpoints, as intended).
    this.memory.bytes.set(parsed.dynamicMemory.subarray(0, this.staticBase), 0);

    // Interpreter-owned header fields must survive a restore.
    this.setupHeaderCapabilities();

    // Rebuild the call stack.
    this.stack.length = 0;
    this.frames.length = 0;

    for (const qf of parsed.frames) {
      const frame: Frame = {
        routineAddress: 0, // not stored by Quetzal; only affects debugger display
        locals: qf.locals.slice(),
        argumentCount: qf.argumentCount,
        returnPC: qf.returnPC,
        storeVariable: qf.storeVariable,
        stackBase: this.stack.length,
      };

      this.frames.push(frame);
      for (const word of qf.evalStack) this.stack.push(word);
    }

    this.current = this.frames[this.frames.length - 1];

    // Resume from the saved point, delivering "2" to the original save's operand.
    this.applyResult(parsed.pc, 2);
  }

  private applyResult(operandAddr: number, value: number): void {
    if (this.version <= 3) {
      this.applyBranchAt(operandAddr, value !== 0);
    } else {
      const varNum = this.memory.readByte(operandAddr);

      this.pc = operandAddr + 1;
      this.writeVariable(varNum, value);
    }
  }

  private applyBranchAt(addr: number, condition: boolean): void {
    const b1 = this.memory.readByte(addr);
    const whenTrue = (b1 & 0x80) !== 0;

    let next = addr + 1;
    let offset: number;

    if ((b1 & 0x40) !== 0) {
      offset = b1 & 0x3f;
    } else {
      const b2 = this.memory.readByte(next);

      next++;

      let v = ((b1 & 0x3f) << 8) | b2;

      if (v & 0x2000) v -= 0x4000;

      offset = v;
    }

    this.pc = next;

    if (condition === whenTrue) {
      if (offset === 0) this.return_(0);
      else if (offset === 1) this.return_(1);
      else this.pc = next + offset - 2;
    }
  }
}
