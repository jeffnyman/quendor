import "./style.css";

// The engine, through Quendor's public API — the same surface rezrov uses, but
// here with none of the debugger: just load a story and play it.
import { Story, Machine, RunState, unwrapStory } from "quendor";
import { escapeHtml, renderRow } from "./format.ts";
import { keyToZscii, shouldRedirectToInput } from "./keys.ts";

document.documentElement.classList.replace("no-js", "js");

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const els = {
  file: $<HTMLInputElement>("#file"),
  screen: $("#screen"),
  input: $<HTMLInputElement>("#input"),
};

let storyBytes: Uint8Array | null = null;
let machine: Machine | null = null;

/**
 * Draw the whole screen grid — quendor owns the screen model (see
 * docs/screen-model.md), so the display is just its cell grid rendered row by
 * row. The v3 status line is a separate string, drawn as a bar over row 0. A
 * pending [More] pause shows a prompt the player acknowledges with any key.
 */
function renderScreen(m: Machine): void {
  const s = m.screen;
  const rows: string[] = [];

  if (s.statusLine) {
    rows.push(`<div class="statusbar">${escapeHtml(s.statusLine)}</div>`);
  }

  const start = s.statusLine ? 1 : 0; // the status bar stands in for grid row 0
  for (let r = start; r < s.grid.length; r++) {
    rows.push(renderRow(s.grid[r]));
  }

  if (m.pendingInputKind === "more") {
    rows.push(`<div class="more">— more — (press any key)</div>`);
  }

  els.screen.innerHTML = rows.join("");
}

/** The line-input box is live only when the game is waiting on a full line. */
function syncInput(m: Machine): void {
  const readingLine =
    m.state === RunState.WaitingForInput &&
    m.pendingInputKind !== "more" &&
    m.pendingInputKind !== "char";

  els.input.disabled = !readingLine;
  if (readingLine) els.input.focus();
}

/** Run the engine to its next stopping point (a prompt, [More], or halt). */
function advance(): void {
  if (!machine) return;

  try {
    machine.run(20_000_000);
  } catch (err) {
    els.screen.innerHTML += `<div class="fatal">error: ${escapeHtml((err as Error).message)}</div>`;
    return;
  }

  renderScreen(machine);
  syncInput(machine);
}

function reset(): void {
  if (!storyBytes) return;

  machine = new Machine(new Story(storyBytes));
  machine.onOutput = (): void => {}; // the grid is the display; output lands there
  machine.onClearScreen = (): void => {}; // erase clears the grid; the render shows it

  els.screen.textContent = "";
  advance();
}

async function loadStory(bytes: Uint8Array): Promise<void> {
  storyBytes = unwrapStory(bytes); // accept bare stories or Blorb (.zblorb)
  reset();
}

async function onFileChange(): Promise<void> {
  const f = els.file.files?.[0];
  if (!f) return;
  await loadStory(new Uint8Array(await f.arrayBuffer()));
}

function submitInput(): void {
  if (!machine || machine.state !== RunState.WaitingForInput) return;

  const line = els.input.value;
  machine.screen.print(line + "\n"); // echo into the grid before the game responds
  els.input.value = "";
  machine.provideInput(line);
  advance();
}

/** read_char: deliver a single mapped keystroke to the machine in real time. */
function deliverCharKey(e: KeyboardEvent, m: Machine): void {
  const code = keyToZscii(e);
  if (code === null) return;

  e.preventDefault();
  m.provideKey(code);
  advance();
}

/** A keystroke outside the command box jumps into it. */
function redirectTyping(e: KeyboardEvent): void {
  if (!shouldRedirectToInput(e, els.input)) return;

  els.input.focus();
  if (e.key.length === 1) {
    els.input.value += e.key; // capture the first char, lost to the unfocused window otherwise
    e.preventDefault();
  }
}

els.file.addEventListener("change", () => void onFileChange());

els.input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // Submitting a line can synchronously reach a read_char or [More] prompt; keep
  // this Enter from bubbling to the window handler and being eaten as that key.
  e.stopPropagation();
  submitInput();
});

window.addEventListener("keydown", (e) => {
  if (!machine) return;

  // [More] prompt: any key acknowledges the pause and pages forward.
  if (machine.pendingInputKind === "more") {
    e.preventDefault();
    machine.continueFromMore();
    advance();
    return;
  }

  if (machine.pendingInputKind === "char") {
    deliverCharKey(e, machine);
    return;
  }

  redirectTyping(e);
});
