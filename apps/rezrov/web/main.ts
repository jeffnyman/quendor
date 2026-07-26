import "./style.css";

// The engine, imported through Quendor's public API (src/index.ts) rather than
// reaching into individual modules.
import { Story, Machine, unwrapStory } from "quendor";
import type { OutputAttrs } from "quendor";
import {
  escapeHtml,
  hex,
  outputRunCss,
  renderUpperRow,
  resolveAttrs,
  signed,
  zColorCss,
} from "./format.ts";
import {
  computeLabels,
  currentRoutineAddr,
  decodeRoutine,
  disasmEmptyMsg,
  disasmHtml,
  routineCodeStart,
  routineLabel,
} from "./disasm-model.ts";
import { computeControls } from "./controls.ts";
import { objectsHtml } from "./objects-model.ts";

document.documentElement.classList.replace("no-js", "js");

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

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

function appendOutput(text: string, attrs?: OutputAttrs): void {
  const { style, fg, bg } = resolveAttrs(attrs);

  // A normal (non-reverse) run defines the page colour for the whole area.
  if ((style & 1) === 0) setTerminalColors(fg, bg);

  const css = outputRunCss(style, fg, bg, termFg, termBg);

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

  const c = computeControls(machine.state, machine.pendingInputKind, mode);

  els.reset.disabled = false;
  els.step.disabled = c.stepDisabled;
  els.cont.disabled = c.contDisabled;
  els.input.disabled = c.inputDisabled;
  els.input.placeholder = c.placeholder;

  if (c.focusInput) els.input.focus();
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
  const following = viewRoutine === null;
  const routineAddr = viewRoutine ?? currentRoutineAddr(machine);

  els.dFollowPC.classList.toggle("active", following);
  els.dBack.disabled = navHistory.length === 0;
  els.dLoc.textContent = routineLabel(routineAddr, following);

  const codeStart = routineCodeStart(machine, routineAddr, following);
  if (codeStart === null) {
    els.disasm.innerHTML = disasmEmptyMsg(routineAddr);
    return;
  }

  const insns = decodeRoutine(machine, codeStart);
  const labels = computeLabels(insns);
  els.disasm.innerHTML = disasmHtml(insns, machine, labels, breakpoints);

  const pcRow = els.disasm.querySelector<HTMLElement>(".dline.pc");
  if (following && pcRow) pcRow.scrollIntoView({ block: "center" });
  else els.disasm.scrollTop = 0;
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
  els.objects.innerHTML = objectsHtml(machine, expandedObjects);
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
