<h1 align="center">

<img src="./assets/zexplorer-title.png" alt="Zexplorer"/>

</h1>

<div align="center">
<p><strong>A Headless Z-Machine Explorer and Debugger</strong></p>
<p><em>Inspect, disassemble, run, and step through story files.</em></p>

[![npm](https://img.shields.io/npm/v/zexplorer.svg)](https://www.npmjs.com/package/zexplorer)
[![license](https://img.shields.io/npm/l/zexplorer.svg)](https://github.com/jeffnyman/quendor/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/zexplorer.svg)](https://nodejs.org)

</div>

`zexp` is the developer's companion to [quendor](https://github.com/jeffnyman/quendor), the Z-Machine engine it's built on. Where quendor _plays_ a story, `zexp` takes it apart: dump the header and object tree, disassemble reachable routines, inspect a Blorb's resources, run a story headless, or drop into an interactive step-through debugger. It's in the lineage of the classic `ztools` (`infodump`, `txd`).

## Install

```bash
npm install -g zexplorer
```

This puts the `zexp` command on your path.

## Commands

```bash
zexp <command> [args]
```

| Command                                | Description                                             |
| -------------------------------------- | ------------------------------------------------------- |
| `header <story-file>`                  | Parse and print the story header.                       |
| `abbrevs <story-file>`                 | Decode the abbreviation table.                          |
| `dump <story-file> [out-file]`         | Dump the header plus the object/property tables.        |
| `disasm <story-file> [hex-addr]`       | Disassemble every reachable routine/jump/branch target. |
| `run <story-file> [options]`           | Execute the story headless (stdin/stdout).              |
| `debug <story-file> [options]`         | Step through a story in the interactive debugger.       |
| `blorb <blorb-file> [--extract <dir>]` | Inspect a Blorb's resources (optionally extract them).  |

Run `zexp --help` for the full usage summary.

### Options (for `run` and `debug`)

| Flag                      | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| `--trace <file>`          | Log every executed instruction to `<file>` (for `run`).        |
| `--seed N`                | Fix the RNG seed for reproducible playthroughs.                |
| `--tandy`                 | Set the v1–3 "Tandy" flag.                                     |
| `--interpreter N`         | Interpreter number reported to the game (default `6`, IBM PC). |
| `--interpreter-version C` | Interpreter version letter (default `A`).                      |

## Debugger

`zexp debug <story-file>` drops into a gdb-style REPL over the running machine:

| Command     | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `s [n]`     | Step one instruction (or `n`).                                |
| `c`         | Continue until a breakpoint, watchpoint, input, or halt.      |
| `b <a>`     | Set a breakpoint at hex address `a`; `db <a>` clears it.      |
| `w <a>`     | Watch the word at `a` (breaks on change); `dw <a>` unwatches. |
| `bt`        | Backtrace — the current call stack.                           |
| `regs`      | Program counter, state, current locals, and eval stack.       |
| `globals`   | The non-zero global variables.                                |
| `x <a> [n]` | Examine `n` bytes of memory at `a` (default 16).              |
| `i <text>`  | Supply a line of input when the game is waiting for one.      |
| `q`         | Quit the debugger.                                            |

Addresses are hexadecimal; step counts and byte counts are decimal. Saving in-game writes a Quetzal `<story-file>.qzl` slot beside the story.

### Example session

```
$ zexp debug zork1.z3
zexp debugger. commands: s[n] c b <a> db <a> w <a> dw <a> bt regs globals x <a> [n] i <text> q
  0x4f05:  call            #2779 -> sp
(zexp) b 5000
breakpoints: 0x5000
(zexp) c
[paused at 0x5000]
(zexp) regs
  pc=0x5000  state=paused  #insn=137
  locals=[0x0001, 0x0000]
  stack=[]
(zexp) w 2680
watchpoints: 0x2680, 0x2681
(zexp) c
[watchpoint 0x2680: 0x0000 -> 0x0001]
(zexp) q
```

## Development

```bash
vp install   # install dependencies
vp test      # run the tests
vp pack      # build the CLI (dist-cli)
vp dev       # run the companion web explorer
```

zexplorer is part of a larger project — a Z-Machine engine ([quendor](https://github.com/jeffnyman/quendor)) plus this debugger — developed in the open as a study in specification-accurate implementation.

## License

[MIT](https://github.com/jeffnyman/quendor/blob/main/LICENSE) © Jeff Nyman
