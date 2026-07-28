import "./style.css";

// The engine, through Quendor's public API — the same surface rezrov uses, but
// here with none of the debugger: just load a story and play it.
import { Story, Machine, RunState, unwrapStory, parseBlorb, type BlorbPicture } from "quendor";
import { escapeHtml, renderScreenHtml, type InputOverlay } from "./format.ts";
import { keyToZscii } from "./keys.ts";

document.documentElement.classList.replace("no-js", "js");

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const els = {
  file: $<HTMLInputElement>("#file"),
  screen: $("#screen"),
  // Off-screen; it edits the text, the caret is drawn inline on the grid.
  input: $<HTMLInputElement>("#input"),
  splash: $("#splash"),
  splashImg: $<HTMLImageElement>("#splashimg"),
};

let storyBytes: Uint8Array | null = null;
let machine: Machine | null = null;

/** True while the game is blocked on a full line of input (not a single key or [More]). */
function isLineReading(m: Machine): boolean {
  return (
    m.state === RunState.WaitingForInput &&
    m.pendingInputKind !== "more" &&
    m.pendingInputKind !== "char"
  );
}

/**
 * Draw the whole screen — quendor owns the screen model (see
 * docs/screen-model.md); this is a thin adapter that reads the machine and the
 * harvester's caret, then hands the pure composition to renderScreenHtml.
 */
function renderScreen(m: Machine): void {
  const s = m.screen;
  const overlay: InputOverlay | null = isLineReading(m)
    ? {
        row: s.lowerCursor.row,
        col: s.lowerCursor.col,
        value: els.input.value,
        caret: els.input.selectionStart ?? els.input.value.length,
      }
    : null;

  els.screen.innerHTML = renderScreenHtml(
    s.grid,
    s.statusLine,
    overlay,
    m.pendingInputKind === "more",
  );
}

/** Focus the harvester while the game wants a line; disable it otherwise. */
function syncInput(m: Machine): void {
  const lineReading = isLineReading(m);
  els.input.disabled = !lineReading;
  if (lineReading) els.input.focus();
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

  // Report as a DEC-20 (interpreter 1). A terminal-grade machine: Beyond Zork
  // offers its clean text display for it (answer "no" to the "Is this a VT220?"
  // prompt), which reads far better than the character-graphics mode's font-3
  // approximations — the same choice the CLI makes. Colour still comes through.
  machine = new Machine(new Story(storyBytes), { interpreterNumber: 1 });
  machine.onOutput = (): void => {}; // the grid is the display; output lands there
  machine.onClearScreen = (): void => {}; // erase clears the grid; the render shows it

  els.input.value = "";
  els.screen.textContent = "";
  advance();
}

async function loadStory(bytes: Uint8Array): Promise<void> {
  storyBytes = unwrapStory(bytes); // accept bare stories or Blorb (.zblorb)
  reset();
}

/**
 * Sort a batch of handed-over files into a story image and, if present, a title
 * picture. A bare `.z*` file isn't a Blorb; a `.zblorb` bundles the story and may
 * carry pictures; a resource `.blb` (Beyond Zork's splash) carries pictures and no
 * story. The story and its art often ship separately, so we pair whatever came in.
 */
async function sortHandedFiles(
  files: FileList,
): Promise<{ story: Uint8Array | null; picture: BlorbPicture | null }> {
  let story: Uint8Array | null = null;
  let picture: BlorbPicture | null = null;

  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const blorb = parseBlorb(bytes); // null when it isn't a Blorb (a bare story image)

    if (!blorb) {
      story = bytes;
    } else {
      if (blorb.story) story = blorb.story;
      const cover = [...blorb.pictures.values()].find((p) => p.format !== "rect");
      picture ??= cover ?? null;
    }
  }

  return { story, picture };
}

/** Take everything the player was handed at once (a multi-select or a drop) and play it. */
async function onFilesSelected(files: FileList): Promise<void> {
  const { story, picture } = await sortHandedFiles(files);
  if (!story) return; // nothing playable was handed to us

  if (picture) showSplash(picture, () => void loadStory(story));
  else await loadStory(story);
}

/** Show a title picture full-screen; a click or any key dismisses it and begins. */
function showSplash(pic: BlorbPicture, begin: () => void): void {
  const blob = new Blob([new Uint8Array(pic.data)], { type: `image/${pic.format}` });
  const url = URL.createObjectURL(blob);
  els.splashImg.src = url;
  els.splash.hidden = false;

  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    els.splash.hidden = true;
    URL.revokeObjectURL(url);
    els.splash.removeEventListener("click", dismiss);
    window.removeEventListener("keydown", dismiss);
    begin();
  };

  els.splash.addEventListener("click", dismiss);
  window.addEventListener("keydown", dismiss);
}

function submitInput(): void {
  if (!machine || !isLineReading(machine)) return;

  const line = els.input.value;
  machine.screen.print(line + "\n"); // commit the typed line into the grid, where the caret was
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

els.file.addEventListener("change", () => {
  if (els.file.files?.length) void onFilesSelected(els.file.files);
});

// Drop a story (and its resource Blorb) anywhere on the window.
document.body.addEventListener("dragover", (e) => e.preventDefault());
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files?.length) void onFilesSelected(files);
});

// Mirror the harvested text into the on-screen caret as it changes: `input`
// covers typing/paste; `keyup` covers caret moves (arrow keys) that don't type.
els.input.addEventListener("input", () => {
  if (machine) renderScreen(machine);
});
els.input.addEventListener("keyup", () => {
  if (machine) renderScreen(machine);
});

els.input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // Submitting can synchronously reach a read_char or [More] prompt; keep this
  // Enter from bubbling to the window handler and being eaten as that key.
  e.stopPropagation();
  submitInput();
});

// Clicking the game surface refocuses the harvester if focus was lost.
els.screen.addEventListener("mousedown", () => {
  if (machine && isLineReading(machine)) setTimeout(() => els.input.focus(), 0);
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
  }
});
