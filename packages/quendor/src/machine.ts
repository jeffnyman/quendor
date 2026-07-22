import type { ZText } from "./text.ts";
import { HeaderOffset, unpackRoutineAddress } from "./header.ts";
import { InstructionReader, OperandKind, type Instruction } from "./instruction.ts";
import type { Memory } from "./memory.ts";
import type { Story } from "./story.ts";
import { ObjectTable } from "./objects.ts";

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
  private readonly initialProgramCounter: number;
  private readonly dictionaryAddress: number;

  private pc = 0;
  private readonly stack: number[] = [];
  private readonly frames: Frame[] = [];
  private current: Frame;
  private instructionCount = 0;
  private currentInstruction!: Instruction;
  private ops: number[] = [];

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

  constructor(story: Story) {
    this.memory = story.memory;
    this.version = story.header.version;
    this.text = story.text;
    this.initialProgramCounter = story.header.initialProgramCounter;

    this.interpreterNumber = 6; // IBM PC
    this.interpreterVersion = 0x41; // 'A'
    this.routinesOffset = story.header.routinesOffset;
    this.globalsAddress = story.header.globalVariablesTableAddress;
    this.dictionaryAddress = story.header.dictionaryAddress;

    this.objects = new ObjectTable(this.memory, this.version, story.header.objectTableAddress);

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

      // --- bitwise ---
      case "and":
        return this.store(o[0] & o[1]);

      // --- inc / dec ---
      case "inc":
        this.incDec(o[0], +1);
        return;
      case "inc_chk": {
        const v = this.incDec(o[0], +1);
        return this.branchOn(v > toS16(o[1]));
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
      case "store":
        return this.writeVariableIndirect(o[0], o[1]);
      case "loadw":
        return this.store(this.memory.readWord((o[0] + o[1] * 2) & 0xffff));
      case "loadb":
        return this.store(this.memory.readByte((o[0] + o[1]) & 0xffff));
      case "storew":
        return this.memory.writeWord((o[0] + o[1] * 2) & 0xffff, o[2]);
      case "push":
        return this.writeVariable(0, o[0]);
      case "pull":
        return this.writeVariableIndirect(o[0], this.readVariable(0));

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
      case "insert_obj":
        if (o[0] !== 0 && o[1] !== 0) this.objects.moveObject(o[0], o[1]);
        return;
      case "get_prop":
        return this.store(this.getProp(o[0], o[1]));
      case "put_prop":
        return this.putProp(o[0], o[1], o[2]);

      // --- output ---
      case "print":
        return this.print(this.decodeInline());
      case "new_line":
        return this.print("\n");
      case "print_char":
        return this.print(String.fromCharCode(o[0]));
      case "print_num":
        return this.print(String(toS16(o[0])));
      case "print_obj":
        return this.print(this.text.decodeAtAddress(this.objects.getShortNameAddress(o[0]) + 1));

      // --- input ---
      case "sread":
        return this.sread(o);

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
}
