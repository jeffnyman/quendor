import { RunState } from "quendor";

/** Toolbar + input-box enablement derived from the machine's state. */
export interface Controls {
  stepDisabled: boolean;
  contDisabled: boolean;
  inputDisabled: boolean;
  placeholder: string;
  focusInput: boolean;
}

/**
 * Map the run state (and, in Play mode, the pending input kind) to the control
 * panel's enabled/placeholder/focus state. Pure, so it's unit-testable.
 */
export function computeControls(
  state: RunState,
  pendingInputKind: "line" | "char" | "more" | null,
  mode: "debug" | "play",
): Controls {
  const waiting = state === RunState.WaitingForInput;
  const halted = state === RunState.Halted;

  // In Play mode, single-key (read_char) and [MORE] prompts are handled live via
  // keydown, so the line-input box is disabled and a hint is shown instead.
  const keyPrompt = waiting && pendingInputKind === "char" && mode === "play";
  const morePrompt = waiting && pendingInputKind === "more" && mode === "play";

  return {
    stepDisabled: halted || waiting,
    contDisabled: halted,
    inputDisabled: !waiting || keyPrompt || morePrompt,
    placeholder: morePrompt
      ? "[MORE] — press any key…"
      : keyPrompt
        ? "press a key…"
        : "type a command and press Enter...",
    focusInput: waiting && !keyPrompt && !morePrompt,
  };
}
