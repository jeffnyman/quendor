import { HeaderOffset, unpackRoutineAddress } from "./header.ts";
import { InstructionReader, OperandKind, type Instruction } from "./instruction.ts";
import type { Memory } from "./memory.ts";
import type { Story } from "./story.ts";

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

export class Machine {
  readonly memory: Memory;
  readonly version: number;

  /** Header interpreter number (0x1e) — defaults to 6 (IBM PC). */
  readonly interpreterNumber: number;
  /** Header interpreter version letter (0x1f) — defaults to 'A'. */
  readonly interpreterVersion: number;

  private readonly globalsAddress: number;
  private readonly routinesOffset: number;
  private readonly initialProgramCounter: number;

  private pc = 0;
  private readonly stack: number[] = [];
  private readonly frames: Frame[] = [];
  private current: Frame;
  private instructionCount = 0;
  private currentInstruction!: Instruction;
  private ops: number[] = [];

  private runState: RunState = RunState.Running;

  /** Breakpoints, keyed by instruction address. */
  private skipBreakpointOnce = false;
  readonly breakpoints = new Set<number>();

  // Data watchpoints: break when a watched byte's value changes.
  private watchTriggered = false;

  constructor(story: Story) {
    this.memory = story.memory;
    this.version = story.header.version;
    this.initialProgramCounter = story.header.initialProgramCounter;

    this.interpreterNumber = 6; // IBM PC
    this.interpreterVersion = 0x41; // 'A'
    this.routinesOffset = story.header.routinesOffset;
    this.globalsAddress = story.header.globalVariablesTableAddress;

    this.setupHeaderCapabilities();
    this.current = this.setupInitialFrame(this.initialProgramCounter);
  }

  /** The call frame currently executing. */
  get currentFrame(): Frame {
    return this.current;
  }

  onOutput: (text: string) => void = () => {};

  /**
   * Trace hook: fired for every instruction just before it executes, with the
   * current call depth (main routine = 1) and its resolved operand values.
   * Powers the CLI's `--trace` execution logger; a no-op (negligible) by default.
   */
  onTrace: (insn: Instruction, depth: number, ops: number[]) => void = () => {};

  /**
   * Run until the machine halts, blocks on input, or hits a breakpoint.
   * Returns the resulting state. Safe to call again to resume from Paused.
   */
  run(maxInstructions = 1): RunState {
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

  private execute(name: string): void {
    const o = this.ops;
    console.log(o); // REMOVE

    switch (name) {
      default:
        throw new Error(
          `unimplemented opcode '${name}' at 0x${this.currentInstruction.address.toString(16)}`,
        );
    }
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
