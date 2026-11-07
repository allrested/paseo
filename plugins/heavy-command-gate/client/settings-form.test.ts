import { describe, expect, it } from "vitest";
import {
  COMMAND_MESSAGE,
  ESTIMATE_MESSAGE,
  PATTERNS_MESSAGE,
  RESERVE_MESSAGE,
  SLOTS_MESSAGE,
  gateSettings,
} from "../shared/settings.js";
import {
  editorReducer,
  parseDraft,
  resetRow,
  saveRow,
  toDraft,
  type EditorState,
  type RequestKind,
  type RequestState,
  type SettingsDraft,
} from "./settings-form.js";

const LINE_MESSAGE = "Write the estimate in GB, a space, then the command";
const DEFAULTS = gateSettings.schema.parse({});
const SAVED: SettingsDraft = { slots: "1", reserveGb: "1", patterns: "3 tsc" };
const IDLE: EditorState = { draft: null, generation: 0, lastRequest: null };
const EDITING: EditorState = {
  draft: { slots: "2", reserveGb: "1", patterns: "3 tsc", revision: "r1" },
  generation: 3,
  lastRequest: null,
};
const QUIET: RequestState = { saving: false, saveError: null };
const RUNNING: RequestState = { saving: true, saveError: null };

function draft(patterns: string, slots = "1", reserveGb = "1"): SettingsDraft {
  return { slots, reserveGb, patterns };
}

function rows(lastRequest: RequestKind | null, request: RequestState, armed = false) {
  return { save: saveRow(lastRequest, request), reset: resetRow(lastRequest, request, armed) };
}

describe("toDraft", () => {
  it("shows slots, the reserve and one line per pattern, estimate first", () => {
    const values = gateSettings.schema.parse({
      slots: 2,
      reserveGb: 0.5,
      patterns: [
        { command: "npm run typecheck", estimateGb: 3 },
        { command: "npm ci", estimateGb: 1.5 },
      ],
    });
    expect(toDraft(values)).toEqual({
      slots: "2",
      reserveGb: "0.5",
      patterns: "3 npm run typecheck\n1.5 npm ci",
    });
  });
});

describe("parseDraft", () => {
  it("reads the default settings back unchanged", () => {
    expect(parseDraft(toDraft(DEFAULTS), true)).toEqual({ ok: true, values: DEFAULTS });
  });

  it("keeps the on/off value it is given", () => {
    const result = parseDraft(draft("3 tsc"), false);
    expect(result).toEqual({
      ok: true,
      values: {
        enabled: false,
        slots: 1,
        reserveGb: 1,
        patterns: [{ command: "tsc", estimateGb: 3 }],
      },
    });
  });

  it("skips blank lines and # comments, and accepts an empty list", () => {
    expect(parseDraft(draft("# typecheckers\n\n  3 tsc  \n"), true)).toMatchObject({
      ok: true,
      values: { patterns: [{ command: "tsc", estimateGb: 3 }] },
    });
    expect(parseDraft(draft(""), true)).toMatchObject({ ok: true, values: { patterns: [] } });
  });

  it("names the line of a pattern without a command", () => {
    expect(parseDraft(draft("3 tsc\n2"), true)).toEqual({
      ok: false,
      errors: { slots: null, reserveGb: null, patterns: `Line 2: ${LINE_MESSAGE}` },
    });
  });

  it("names the line of a bad estimate and a bad command, counting comment lines", () => {
    expect(parseDraft(draft("# heavy\nlots tsc\n2 npm --workspace x test"), true)).toEqual({
      ok: false,
      errors: {
        slots: null,
        reserveGb: null,
        patterns: `Line 2: ${ESTIMATE_MESSAGE}\nLine 3: ${COMMAND_MESSAGE}`,
      },
    });
  });

  it("lists the problems of both kinds in line order", () => {
    expect(parseDraft(draft("lots tsc\n2"), true)).toEqual({
      ok: false,
      errors: {
        slots: null,
        reserveGb: null,
        patterns: `Line 1: ${ESTIMATE_MESSAGE}\nLine 2: ${LINE_MESSAGE}`,
      },
    });
  });

  it("names the later line of a command listed twice", () => {
    expect(parseDraft(draft("3 tsc\n2 vitest\n1 tsc"), true)).toEqual({
      ok: false,
      errors: {
        slots: null,
        reserveGb: null,
        patterns: 'Line 3: Command "tsc" is listed more than once',
      },
    });
  });

  it("rejects more than 100 commands without naming a line", () => {
    const lines = Array.from({ length: 101 }, (_, index) => `1 command${index}`).join("\n");
    expect(parseDraft(draft(lines), true)).toEqual({
      ok: false,
      errors: { slots: null, reserveGb: null, patterns: PATTERNS_MESSAGE },
    });
  });

  it("reports slot and reserve errors in their own fields", () => {
    expect(parseDraft(draft("3 tsc", "", "65"), true)).toEqual({
      ok: false,
      errors: { slots: SLOTS_MESSAGE, reserveGb: RESERVE_MESSAGE, patterns: null },
    });
  });

  it("reads a slot count with surrounding spaces", () => {
    expect(parseDraft(draft("3 tsc", " 2 ", "0"), true)).toMatchObject({
      ok: true,
      values: { slots: 2, reserveGb: 0 },
    });
  });
});

describe("editorReducer", () => {
  it("starts a draft from the saved text on the first edit", () => {
    expect(
      editorReducer(IDLE, { type: "edit", patch: { slots: "2" }, saved: SAVED, revision: "r1" }),
    ).toEqual({
      draft: { slots: "2", reserveGb: "1", patterns: "3 tsc", revision: "r1" },
      generation: 0,
      lastRequest: null,
    });
  });

  it("keeps the revision a draft started from through later edits", () => {
    const moved: SettingsDraft = { slots: "1", reserveGb: "1", patterns: "2 tsc" };
    expect(
      editorReducer(EDITING, {
        type: "edit",
        patch: { reserveGb: "2" },
        saved: moved,
        revision: "r2",
      }),
    ).toEqual({
      draft: { slots: "2", reserveGb: "2", patterns: "3 tsc", revision: "r1" },
      generation: 3,
      lastRequest: null,
    });
  });

  it("records a save as the last request and keeps the draft until the save succeeds", () => {
    const saving = editorReducer(EDITING, { type: "save-started" });
    expect(saving).toEqual({
      draft: { slots: "2", reserveGb: "1", patterns: "3 tsc", revision: "r1" },
      generation: 3,
      lastRequest: "save",
    });
    expect(editorReducer(saving, { type: "save-succeeded" })).toEqual({
      draft: null,
      generation: 3,
      lastRequest: "save",
    });
  });

  it("clears the draft and bumps the generation on Discard", () => {
    expect(editorReducer({ ...EDITING, lastRequest: "save" }, { type: "discard" })).toEqual({
      draft: null,
      generation: 4,
      lastRequest: null,
    });
  });

  it("clears the draft, bumps the generation and records a reset on Reset", () => {
    expect(editorReducer(EDITING, { type: "reset-started" })).toEqual({
      draft: null,
      generation: 4,
      lastRequest: "reset",
    });
  });
});

describe("saveRow and resetRow", () => {
  it("shows a failed save on the save row only", () => {
    expect(rows("save", { saving: false, saveError: "Could not save" })).toEqual({
      save: { actionLabel: "Save", error: "Could not save" },
      reset: { actionLabel: "Reset", error: null },
    });
  });

  it("labels the save row Saving... while a save runs", () => {
    expect(rows("save", RUNNING)).toEqual({
      save: { actionLabel: "Saving...", error: null },
      reset: { actionLabel: "Reset", error: null },
    });
  });

  it("labels the reset row Resetting... while a reset runs, and Save keeps its label", () => {
    expect(rows("reset", RUNNING)).toEqual({
      save: { actionLabel: "Save", error: null },
      reset: { actionLabel: "Resetting...", error: null },
    });
  });

  it("shows a failed reset on the reset row only", () => {
    expect(rows("reset", { saving: false, saveError: "Could not reset" })).toEqual({
      save: { actionLabel: "Save", error: null },
      reset: { actionLabel: "Reset", error: "Could not reset" },
    });
  });

  it("routes the next error to the save row after a failed reset", () => {
    const afterReset = editorReducer(EDITING, { type: "reset-started" });
    const editing = editorReducer(afterReset, {
      type: "edit",
      patch: { slots: "4" },
      saved: SAVED,
      revision: "r2",
    });
    const saving = editorReducer(editing, { type: "save-started" });
    expect(rows(afterReset.lastRequest, { saving: false, saveError: "Could not reset" })).toEqual({
      save: { actionLabel: "Save", error: null },
      reset: { actionLabel: "Reset", error: "Could not reset" },
    });
    expect(rows(saving.lastRequest, { saving: false, saveError: "Could not save" })).toEqual({
      save: { actionLabel: "Save", error: "Could not save" },
      reset: { actionLabel: "Reset", error: null },
    });
  });

  it("labels the reset row Confirm reset while it waits for the second press", () => {
    expect(rows(null, QUIET, true)).toEqual({
      save: { actionLabel: "Save", error: null },
      reset: { actionLabel: "Confirm reset", error: null },
    });
  });
});
