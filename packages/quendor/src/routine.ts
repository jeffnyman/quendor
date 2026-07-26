import type { Memory } from "./memory.ts";

export interface RoutineHeader {
  readonly address: number;
  readonly localCount: number;
  /** Initial local values (all zero in v5+, where they aren't stored). */
  readonly locals: readonly number[];
  /** Address of the first instruction, after the header. */
  readonly codeAddress: number;
}

/**
 * Parse a routine header. A routine begins with a byte giving the number of
 * locals (0..15); in versions 1-4 that is followed by one word of initial
 * value per local, whereas version 5+ omits them (locals start at zero).
 */
export function readRoutineHeader(memory: Memory, version: number, address: number): RoutineHeader {
  const localCount = memory.readByte(address);

  if (localCount > 15) {
    throw new Error(`Invalid local count ${localCount} at routine 0x${address.toString(16)}`);
  }

  const locals: number[] = [];
  let addr = address + 1;

  if (version <= 4) {
    for (let i = 0; i < localCount; i++) {
      locals.push(memory.readWord(addr));
      addr += 2;
    }
  } else {
    for (let i = 0; i < localCount; i++) locals.push(0);
  }

  return { address, localCount, locals, codeAddress: addr };
}
