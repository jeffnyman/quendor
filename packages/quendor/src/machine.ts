import { HeaderOffset } from "./header.ts";
import type { Memory } from "./memory.ts";
import type { Story } from "./story.ts";

export class Machine {
  readonly memory: Memory;

  /** Header interpreter number (0x1e) — defaults to 6 (IBM PC). */
  readonly interpreterNumber: number;
  /** Header interpreter version letter (0x1f) — defaults to 'A'. */
  readonly interpreterVersion: number;

  constructor(story: Story) {
    this.memory = story.memory;
    this.interpreterNumber = 6; // IBM PC
    this.interpreterVersion = 0x41; // 'A'

    this.setupHeaderCapabilities();
  }

  private setupHeaderCapabilities(): void {
    this.memory.writeByte(HeaderOffset.InterpreterNumber, this.interpreterNumber);
    this.memory.writeByte(HeaderOffset.InterpreterVersion, this.interpreterVersion);
  }
}
