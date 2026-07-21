import { HeaderOffset, unpackRoutineAddress } from "./header.ts";
import type { Memory } from "./memory.ts";
import type { Story } from "./story.ts";

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

  private readonly routinesOffset: number;
  private readonly initialProgramCounter: number;

  private pc = 0;
  private readonly stack: number[] = [];
  private readonly frames: Frame[] = [];
  private current: Frame;

  constructor(story: Story) {
    this.memory = story.memory;
    this.version = story.header.version;
    this.initialProgramCounter = story.header.initialProgramCounter;

    this.interpreterNumber = 6; // IBM PC
    this.interpreterVersion = 0x41; // 'A'
    this.routinesOffset = story.header.routinesOffset;

    this.setupHeaderCapabilities();
    this.current = this.setupInitialFrame(this.initialProgramCounter);
  }

  /** The call frame currently executing. */
  get currentFrame(): Frame {
    return this.current;
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
