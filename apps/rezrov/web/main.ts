import "./style.css";

// The engine, imported through Quendor's public API (src/index.ts) rather than
// reaching into individual modules.
import {
  InstructionReader,
  Story,
  Machine,
  RunState,
  OperandKind,
  unwrapStory,
  readRoutineHeader,
  formatInstruction,
  isReturnLike,
} from "quendor";
import type { Cell, OutputAttrs, Instruction } from "quendor";

document.documentElement.classList.replace("no-js", "js");

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const hex = (n: number, w = 4): string => "0x" + n.toString(16).padStart(w, "0");

const signed = (v: number): number => (v >= 0x8000 ? v - 0x10000 : v);

const els = {
  file: $<HTMLInputElement>("#file"),
  dump: $<HTMLButtonElement>("#btn-dump"),
  modePlay: $<HTMLButtonElement>("#mode-play"),
  modeDebug: $<HTMLButtonElement>("#mode-debug"),
  reset: $<HTMLButtonElement>("#btn-reset"),
  step: $<HTMLButtonElement>("#btn-step"),
  cont: $<HTMLButtonElement>("#btn-continue"),
  state: $("#state"),
  icount: $("#icount"),
  screentop: $("#screentop"),
  terminal: $("#terminal"),
  input: $<HTMLInputElement>("#input"),
  dFollowPC: $<HTMLButtonElement>("#d-followpc"),
  dBack: $<HTMLButtonElement>("#d-back"),
  dGoto: $<HTMLInputElement>("#d-goto"),
  dLoc: $("#d-loc"),
  disasm: $("#disasm .body"),
  callstack: $("#callstack .body"),
  locals: $("#locals .body"),
  globals: $("#globals .body"),
  objects: $("#objects"),
  memory: $("#memory"),
};

let storyBytes: Uint8Array | null = null;
let machine: Machine | null = null;
const breakpoints = new Set<number>();
let memoryBase = 0;

// Object tree: which objects have their detail (attributes/properties) expanded.
const expandedObjects = new Set<number>();
// set each render, used when interpreting property values
let objectCountCache = 0;

// The lower window's current "paper" colors, applied to the whole terminal
// (not per-span) so a game that runs on, for example, black-on-white reads
// as a colored page, not as selected/highlighted text.
let termFg = 1;
let termBg = 1;

// UI mode: "debug" shows all panels; "play" shows just the game, but it's the
// SAME Machine — a breakpoint set in debug still fires while playing.
const mode: "debug" | "play" = "debug";

// Disassembly navigation: the routine currently shown. null = follow the PC.
const viewRoutine: number | null = null;
const navHistory: (number | null)[] = [];

/** Z-Machine colour number → CSS colour (null = default/inherit). */
function zColorCss(n: number): string | null {
  return (
    {
      2: "#000000",
      3: "#e05a5a",
      4: "#3fb950",
      5: "#e3d34a",
      6: "#5a8ce0",
      7: "#c678dd",
      8: "#4ac3d3",
      9: "#ffffff",
      10: "#bbbbbb",
      11: "#888888",
      12: "#555555",
    }[n] ?? null
  );
}

function setTerminalColors(fg: number, bg: number): void {
  if (fg === termFg && bg === termBg) return;

  termFg = fg;
  termBg = bg;

  const fgc = zColorCss(fg) ?? "";
  const bgc = zColorCss(bg) ?? "";

  // Page the whole transcript and the input box together (empty string falls
  // back to the theme CSS, so default-colour games are untouched).
  els.terminal.style.color = fgc;
  els.terminal.style.background = bgc;
  els.input.style.color = fgc;
  els.input.style.background = bgc;
}

/** Build the inline CSS for a run given style bits and colours. */
function attrCss(style: number, fg: number, bg: number): string[] {
  const fgc = zColorCss(fg);
  const bgc = zColorCss(bg);
  const css: string[] = [];

  if (style & 1) {
    // reverse video: swap fg/bg (falling back to the theme colours)
    css.push(`color:${bgc ?? "var(--bg)"}`, `background:${fgc ?? "var(--fg)"}`);
  } else {
    if (fgc) css.push(`color:${fgc}`);
    if (bgc) css.push(`background:${bgc}`);
  }

  if (style & 2) css.push("font-weight:700");
  if (style & 4) css.push("font-style:italic");

  return css;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function currentRoutineAddr(machine: Machine): number | undefined {
  return machine.getCallStack()[0]?.routineAddress;
}

/** The routine target of a `call*` with a constant operand (else null). */
function callTarget(insn: Instruction): number | null {
  if (!machine || !insn.opcode.name.startsWith("call")) return null;
  const op = insn.operands[0];
  if (op.kind === OperandKind.Variable || op.value === 0) return null;
  return machine.unpackRoutineAddress(op.value);
}

/** The in-routine target address of a branch or jump (else null). */
function jumpOrBranchTarget(insn: Instruction): number | null {
  if (insn.branch && insn.branch.targetAddress !== undefined) {
    return insn.branch.targetAddress;
  }

  if (insn.opcode.name === "jump") {
    const op = insn.operands[0];

    if (op.kind !== OperandKind.Variable) {
      return insn.address + insn.length + signed(op.value) - 2;
    }
  }

  return null;
}

function renderUpperRow(row: Cell[]): string {
  let html = "";
  let i = 0;

  while (i < row.length) {
    const { style, fg, bg } = row[i];
    let text = "";
    while (i < row.length && row[i].style === style && row[i].fg === fg && row[i].bg === bg) {
      text += row[i].ch;
      i++;
    }

    const escaped = escapeHtml(text);
    const css = attrCss(style, fg, bg);

    if (css.length === 0) {
      html += escaped;
    } else {
      html += `<span style="${css.join(";")}">${escaped}</span>`;
    }
  }

  return `<div class="upperrow">${html}</div>`;
}

function appendOutput(text: string, attrs?: OutputAttrs): void {
  const style = attrs?.style ?? 0;
  const fg = attrs?.foreground ?? 1;
  const bg = attrs?.background ?? 1;

  // A normal (non-reverse) run defines the page colour for the whole area.
  const reverse = (style & 1) !== 0;

  if (!reverse) setTerminalColors(fg, bg);

  // Only style inline what differs from the page: reverse video (a local
  // swap), bold, italic, and any color that isn't the current page color.
  const css: string[] = [];

  if (reverse) {
    css.push(`color:${zColorCss(bg) ?? "var(--bg)"}`, `background:${zColorCss(fg) ?? "var(--fg)"}`);
  } else {
    if (fg !== termFg && zColorCss(fg)) css.push(`color:${zColorCss(fg)}`);
    if (bg !== termBg && zColorCss(bg)) css.push(`background:${zColorCss(bg)}`);
  }

  if (style & 2) css.push("font-weight:700");
  if (style & 4) css.push("font-style:italic");

  if (css.length === 0) {
    els.terminal.append(document.createTextNode(text));
  } else {
    const span = document.createElement("span");

    span.style.cssText = css.join(";");
    span.textContent = text;
    els.terminal.append(span);
  }

  els.terminal.scrollTop = els.terminal.scrollHeight;
}

function refresh(): void {
  if (!machine) return;

  renderState(machine);
  renderScreen(machine);
  renderDisasm(machine);
  renderCallStack(machine);
  renderLocals(machine);
  renderGlobals(machine);
  renderObjects(machine);
  renderMemory(machine);

  // MORE RENDERS

  const waiting = machine.state === RunState.WaitingForInput;
  const halted = machine.state === RunState.Halted;

  // In Play mode, single-key (read_char) prompts are captured live via keydown,
  // so the line-input box is disabled and a hint is shown instead.
  const keyPrompt = waiting && machine.pendingInputKind === "char" && mode === "play";
  const morePrompt = waiting && machine.pendingInputKind === "more" && mode === "play";

  els.reset.disabled = false;
  els.step.disabled = halted || waiting;
  els.cont.disabled = halted;
  els.input.disabled = !waiting || keyPrompt || morePrompt;
  els.input.placeholder = morePrompt
    ? "[MORE] — press any key…"
    : keyPrompt
      ? "press a key…"
      : "type a command and press Enter...";

  if (waiting && !keyPrompt && !morePrompt) {
    els.input.focus();
  }
}

function renderState(machine: Machine): void {
  els.state.textContent = machine.state;
  els.state.className = machine.state;
  els.icount.textContent = `${machine.instructionCount.toLocaleString()} insns`;
}

/** Render the v3 status bar or the v4+ upper window above the terminal. */
function renderScreen(machine: Machine): void {
  const s = machine.screen;

  if (s.upperHeight > 0) {
    els.screentop.innerHTML = s.upper.map(renderUpperRow).join("");
  } else if (s.statusLine) {
    els.screentop.innerHTML = `<div class="statusbar">${escapeHtml(s.statusLine)}</div>`;
  } else {
    els.screentop.innerHTML = "";
  }
}

function renderDisasm(machine: Machine): void {
  const m = machine;
  els.disasm.innerHTML = "";

  const following = viewRoutine === null;
  const routineAddr = viewRoutine ?? currentRoutineAddr(machine);

  // toolbar state
  els.dFollowPC.classList.toggle("active", following);
  els.dBack.disabled = navHistory.length === 0;
  els.dLoc.textContent =
    routineAddr === undefined
      ? ""
      : `routine ${hex(routineAddr)}${following ? " · following PC" : ""}`;

  if (routineAddr === undefined) {
    els.disasm.innerHTML = `<div class="empty">halted — use “goto” to inspect a routine</div>`;
    return;
  }

  let codeStart: number;

  // §5.5: in v1–5 the entry point (the main frame — no caller, so returnPC 0) is
  // raw code with no routine header, so decode from routineAddr directly.
  const atEntry = following && m.version < 6 && machine.getCallStack()[0].returnPC === 0;

  if (atEntry) {
    codeStart = routineAddr;
  } else {
    try {
      codeStart = readRoutineHeader(m.memory, m.version, routineAddr).codeAddress;
    } catch {
      els.disasm.innerHTML = `<div class="empty">not a routine at ${hex(routineAddr)}</div>`;
      return;
    }
  }

  // Pass 1: decode the whole routine.
  const reader = new InstructionReader(m.memory, m.version, codeStart);
  const insns: Instruction[] = [];

  for (let i = 0; i < 400; i++) {
    let insn: Instruction;

    try {
      insn = reader.next();
    } catch {
      break;
    }
    insns.push(insn);

    if (isReturnLike(insn)) break;
  }

  // Pass 2: name in-routine branch/jump targets L1, L2, … in address order.
  const addrSet = new Set(insns.map((insn) => insn.address));
  const targets = new Set<number>();

  for (const insn of insns) {
    const t = jumpOrBranchTarget(insn);
    if (t !== null && addrSet.has(t)) targets.add(t);
  }

  const labels = new Map<number, string>();

  [...targets]
    .sort((a, b) => a - b)
    .forEach((addr, i) => {
      labels.set(addr, `L${i + 1}`);
    });

  // Pass 3: render.
  let pcRow: HTMLElement | null = null;

  for (const insn of insns) {
    if (labels.has(insn.address)) {
      const lbl = document.createElement("div");
      lbl.className = "dlabel";
      lbl.textContent = `${labels.get(insn.address)}:`;
      els.disasm.append(lbl);
    }

    const row = document.createElement("div");
    row.className = "dline" + (insn.address === m.programCounter ? " pc" : "");
    if (breakpoints.has(insn.address)) row.classList.add("bp");
    row.dataset.addr = String(insn.address);

    let html =
      `<span class="gutter"></span>` +
      `<span class="addr">${hex(insn.address)}</span>` +
      `<span class="text">${escapeHtml(formatInstruction(insn, m.text))}</span>`;

    const ct = callTarget(insn);

    if (ct !== null) {
      html += `<span class="nav" data-nav="${ct}">→ ${hex(ct)}</span>`;
    }

    const jt = jumpOrBranchTarget(insn);

    if (jt !== null) {
      const label = labels.get(jt) ?? hex(jt);
      html += `<span class="nav" data-scroll="${jt}">↳ ${label}</span>`;
    }

    row.innerHTML = html;
    els.disasm.append(row);

    if (insn.address === m.programCounter) {
      pcRow = row;
    }
  }

  if (following && pcRow) {
    pcRow.scrollIntoView({ block: "center" });
  } else {
    els.disasm.scrollTop = 0;
  }
}

function renderCallStack(machine: Machine): void {
  const frames = machine.getCallStack();

  els.callstack.innerHTML = frames
    .map(
      (f, i) =>
        `<div class="kv frame" data-ra="${f.routineAddress}" title="click to view routine">` +
        `#${i} <span>${hex(f.routineAddress)}</span> ` +
        `<span class="dim">args=${f.argumentCount} ret=${hex(f.returnPC)}</span></div>`,
    )
    .join("");
}

function renderLocals(machine: Machine): void {
  const locals = machine.getLocals();
  const stack = machine.getEvalStack();
  const localsHtml = locals.length
    ? locals.map((v, i) => `L${i}=<span>${hex(v)}</span>`).join("&nbsp;&nbsp;")
    : '<span class="dim">none</span>';
  const stackHtml = stack.length
    ? stack.map((v) => `<span>${hex(v)}</span>`).join("&nbsp;")
    : '<span class="dim">empty</span>';
  els.locals.innerHTML =
    `<div class="kv">${localsHtml}</div>` + `<div class="kv dim">stack:&nbsp;${stackHtml}</div>`;
}

function renderGlobals(machine: Machine): void {
  const m = machine;
  const g = m.getGlobals();
  const rows = g
    .map((v, i) => ({ i, v }))
    .filter(({ v }) => v !== 0)
    .map(({ i, v }) => {
      const watched = m.watchpoints.has(m.globalAddress(i));
      return (
        `<tr data-gi="${i}"${watched ? ' class="watch"' : ""} title="click to watch">` +
        `<td class="dim">g${i.toString(16).padStart(2, "0")}</td>` +
        `<td class="num">${hex(v)}</td><td class="dim">${signed(v)}</td></tr>`
      );
    })
    .join("");
  els.globals.innerHTML = rows
    ? `<table>${rows}</table>`
    : `<div class="empty">all globals zero</div>`;
}

function renderObjects(machine: Machine): void {
  const m = machine;
  const objects = m.objects;
  let count: number;

  try {
    count = objects.getObjectCount();
  } catch {
    els.objects.innerHTML = `<div class="empty">no object table</div>`;
    return;
  }

  objectCountCache = count;

  const limit = Math.min(count, 1000);
  const visited = new Set<number>();
  const out: string[] = [];

  const renderNode = (n: number, depth: number): void => {
    if (visited.has(n) || out.length > 4000 || depth > 64) return;
    visited.add(n);

    const expanded = expandedObjects.has(n);
    const name = objectName(machine, n);

    out.push(
      `<div class="objrow" data-obj="${n}" style="padding-left:${8 + depth * 14}px">` +
        `<span class="chev">${expanded ? "▾" : "▸"}</span> ` +
        `<span class="num">${n}</span> ` +
        `${name ? escapeHtml(name) : '<span class="dim">(no name)</span>'}</div>`,
    );

    if (expanded) out.push(objectDetailHtml(machine, n, depth));

    // children (guarding against malformed/cyclic sibling chains)
    let c = objects.getChild(n);

    while (c !== 0 && !visited.has(c)) {
      renderNode(c, depth + 1);
      c = objects.getSibling(c);
    }
  };

  for (let n = 1; n <= limit; n++) {
    if (objects.getParent(n) === 0) renderNode(n, 0);
  }

  // Any object not reachable from a root (malformed table) — show it anyway.
  for (let n = 1; n <= limit; n++) {
    if (!visited.has(n)) renderNode(n, 0);
  }

  const note = count > limit ? `<div class="empty">…and ${count - limit} more</div>` : "";
  els.objects.innerHTML = out.join("") + note;
}

function renderMemory(machine: Machine): void {
  const m = machine;
  const watched = m.watchpoints;
  const rows: string[] = [];

  for (let r = 0; r < 16; r++) {
    const base = memoryBase + r * 16;
    const cells: string[] = [];
    const chars: string[] = [];
    for (let c = 0; c < 16; c++) {
      const a = base + c;
      const b = m.readMemoryByte(a);
      const cls = "b" + (watched.has(a) ? " watch" : "");

      cells.push(`<span class="${cls}" data-a="${a}">${b.toString(16).padStart(2, "0")}</span>`);
      chars.push(b >= 32 && b < 127 ? String.fromCharCode(b) : ".");
    }
    rows.push(
      `<div class="mrow"><span class="addr">${hex(base)}</span>  ` +
        `${cells.join(" ")}  <span class="dim">${escapeHtml(chars.join(""))}</span></div>`,
    );
  }
  els.memory.innerHTML =
    `<div class="kv">addr <input id="memaddr" value="${hex(memoryBase)}" /> ` +
    `<span class="dim">(click a byte to watch)</span></div>` +
    rows.join("");

  const input = $<HTMLInputElement>("#memaddr");

  input.addEventListener("change", () => {
    const v = parseInt(input.value.replace(/^0x/, ""), 16);
    if (!Number.isNaN(v)) {
      memoryBase = v & ~0xf;
      renderMemory(machine);
    }
  });
}

function objectName(machine: Machine, n: number): string {
  const m = machine;
  try {
    const addr = m.objects.getShortNameAddress(n);
    const nameLen = m.readMemoryByte(addr); // 0 => no short name

    return nameLen > 0 ? m.text.decodeAtAddress(addr + 1) : "";
  } catch {
    return "";
  }
}

/**
 * Interpret a 16-bit property word by likely meaning. Dictionary references are
 * unmistakable (their addresses are specific), so they win; a value that is a
 * valid object number is shown as that object's name; otherwise it's a number.
 */
function interpretWord(machine: Machine, w: number): string {
  const m = machine;
  const dictWord = m.getDictionaryWord(w);

  if (dictWord) return `"${dictWord}"`;

  if (w >= 1 && w <= objectCountCache) {
    const name = objectName(machine, w);
    if (name) return `{${name}}`;
  }

  return String(signed(w));
}

function interpretProperty(machine: Machine, dataAddress: number, length: number): string {
  const m = machine;

  // A single byte is often an object reference (e.g. a room exit).
  if (length === 1) return interpretWord(machine, m.readMemoryByte(dataAddress));

  // Otherwise interpret word-shaped data as a sequence of 16-bit values.
  if (length === 0 || length % 2 !== 0 || length > 16) return "";

  const parts: string[] = [];

  for (let i = 0; i < length; i += 2) {
    parts.push(interpretWord(machine, m.readMemoryWord(dataAddress + i)));
  }
  return parts.join(" ");
}

function objectDetailHtml(machine: Machine, n: number, depth: number): string {
  const m = machine;
  const objects = m.objects;
  const pad = 8 + (depth + 1) * 14;
  let attrs = "";
  let props = "";

  try {
    const set = objects.getSetAttributes(n);
    attrs = `attrs: ${set.length ? set.join(", ") : "none"}`;
    props = objects
      .readProperties(n)
      .map((p) => {
        const bytes: string[] = [];
        for (let i = 0; i < p.length; i++) {
          bytes.push(
            m
              .readMemoryByte(p.dataAddress + i)
              .toString(16)
              .padStart(2, "0"),
          );
        }
        const interp = interpretProperty(machine, p.dataAddress, p.length);
        const meaning = interp ? ` <span class="dim">= ${escapeHtml(interp)}</span>` : "";

        return `<div>P${p.number}: <span class="num">${bytes.join(" ")}</span>${meaning}</div>`;
      })
      .join("");
  } catch {
    attrs = "(unreadable)";
  }

  return (
    `<div class="objdetail" style="padding-left:${pad}px">` +
    `<div class="dim">parent ${objects.getParent(n)} · sibling ${objects.getSibling(n)} · child ${objects.getChild(n)}</div>` +
    `<div class="dim">${attrs}</div>${props}</div>`
  );
}

function reset(): void {
  if (!storyBytes) return;
  const story = new Story(storyBytes);

  machine = new Machine(story);
  machine.onOutput = (text, attrs): void => appendOutput(text, attrs);
  machine.onClearScreen = (): void => {
    els.terminal.textContent = "";
  };

  memoryBase = story.header.dictionaryAddress & ~0xf;

  // a story is loaded — a dump can be generated
  els.dump.disabled = false;

  els.terminal.textContent = "";

  // force setTerminalColors to reapply on the first output
  termFg = -1;

  // reset to the theme's default page colors
  setTerminalColors(1, 1);

  refresh();
}

async function loadStory(bytes: Uint8Array): Promise<void> {
  // accept bare stories or Blorb (.zblorb)
  storyBytes = unwrapStory(bytes);
  els.terminal.textContent = "";
  reset();
}

async function onFileChange(): Promise<void> {
  const f = els.file.files?.[0];
  if (!f) return;
  await loadStory(new Uint8Array(await f.arrayBuffer()));
}

els.file.addEventListener("change", () => void onFileChange());
