import { describe, expect, it } from "vitest";
import {
  COMMAND_MESSAGE,
  ESTIMATE_MESSAGE,
  GIB,
  PATTERNS_MESSAGE,
  RESERVE_MESSAGE,
  SLOTS_MESSAGE,
  defaultPatterns,
  gateSettings,
  gbToBytes,
} from "./settings.js";

const SPEC_DEFAULTS = [
  { command: "tsc", estimateGb: 3 },
  { command: "tsgo", estimateGb: 3 },
  { command: "npm run typecheck", estimateGb: 3 },
  { command: "expo export", estimateGb: 3 },
  { command: "vitest", estimateGb: 2 },
  { command: "jest", estimateGb: 2 },
  { command: "npm test", estimateGb: 2 },
  { command: "gradle", estimateGb: 2 },
  { command: "gradlew", estimateGb: 2 },
  { command: "npm ci", estimateGb: 1.5 },
  { command: "npm install", estimateGb: 1.5 },
];

// Each issue as "<path>: <message>", the form the Limits screen relies on.
function issues(input: unknown): string[] {
  const result = gateSettings.schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("gateSettings", () => {
  it("is the host-scoped settings document gate at version 1", () => {
    expect(gateSettings.id).toBe("gate");
    expect(gateSettings.scope).toBe("host");
    expect(gateSettings.version).toBe(1);
  });

  it("defaults to the gate on, one slot, a 1 GB reserve and the spec's heavy commands", () => {
    expect(gateSettings.schema.parse({})).toEqual({
      enabled: true,
      slots: 1,
      reserveGb: 1,
      patterns: SPEC_DEFAULTS,
    });
  });

  it("gives every parse a default list of its own", () => {
    gateSettings.schema.parse({}).patterns.pop();
    expect(gateSettings.schema.parse({}).patterns).toEqual(SPEC_DEFAULTS);
    expect(defaultPatterns()).not.toBe(defaultPatterns());
  });

  it("accepts the bounds", () => {
    expect(
      issues({
        slots: 16,
        reserveGb: 0,
        patterns: [{ command: "npm run typecheck", estimateGb: 0.1 }],
      }),
    ).toEqual([]);
    expect(
      issues({ slots: 1, reserveGb: 64, patterns: [{ command: "tsc", estimateGb: 1024 }] }),
    ).toEqual([]);
  });

  it.each([[0], [17], [1.5], ["2"]])("rejects %j slots", (slots) => {
    expect(issues({ slots })).toEqual([`slots: ${SLOTS_MESSAGE}`]);
  });

  it.each([[-1], [65], ["1"]])("rejects a %j GB reserve", (reserveGb) => {
    expect(issues({ reserveGb })).toEqual([`reserveGb: ${RESERVE_MESSAGE}`]);
  });

  it.each([[""], [" tsc"], ["npm  test"], ["npm test "], ["npm --workspace test"], ["-x"]])(
    "rejects the command %j",
    (command) => {
      expect(issues({ patterns: [{ command, estimateGb: 1 }] })).toEqual([
        `patterns.0.command: ${COMMAND_MESSAGE}`,
      ]);
    },
  );

  it.each([[0], [0.05], [1025], ["3"]])("rejects a %j GB estimate", (estimateGb) => {
    expect(issues({ patterns: [{ command: "tsc", estimateGb }] })).toEqual([
      `patterns.0.estimateGb: ${ESTIMATE_MESSAGE}`,
    ]);
  });

  it("rejects more than 100 commands", () => {
    const patterns = Array.from({ length: 101 }, (_, index) => ({
      command: `tool${index}`,
      estimateGb: 1,
    }));
    expect(issues({ patterns })).toEqual([`patterns: ${PATTERNS_MESSAGE}`]);
  });

  it("rejects a command listed twice", () => {
    expect(
      issues({
        patterns: [
          { command: "tsc", estimateGb: 3 },
          { command: "vitest", estimateGb: 2 },
          { command: "tsc", estimateGb: 1 },
        ],
      }),
    ).toEqual(['patterns.2.command: Command "tsc" is listed more than once']);
  });
});

describe("gbToBytes", () => {
  it("counts a GB as 2^30 bytes and rounds to whole bytes", () => {
    expect(GIB).toBe(1_073_741_824);
    expect(gbToBytes(1.5)).toBe(1_610_612_736);
    expect(gbToBytes(0.1)).toBe(107_374_182);
    expect(gbToBytes(0)).toBe(0);
  });
});
