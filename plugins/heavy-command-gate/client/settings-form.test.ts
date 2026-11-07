import { describe, expect, it } from "vitest";
import {
  COMMAND_MESSAGE,
  ESTIMATE_MESSAGE,
  RESERVE_MESSAGE,
  SLOTS_MESSAGE,
  gateSettings,
} from "../shared/settings.js";
import { parseDraft, toDraft, type SettingsDraft } from "./settings-form.js";

const LINE_MESSAGE = "write the estimate in GB, a space, then the command";
const DEFAULTS = gateSettings.schema.parse({});

function draft(patterns: string, slots = "1", reserveGb = "1"): SettingsDraft {
  return { slots, reserveGb, patterns };
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
