import { describe, expect, it } from "vitest";
import { hasTouchScreen, rowLabel, tokensBanner } from "./model.js";

const base = {
  id: "f1",
  projectKey: "p",
  name: "Login",
  createdAt: 0,
  lastAgentId: null,
  status: "stopped" as const,
  error: null,
  outOfStep: false,
};

describe("rowLabel", () => {
  it("says closed, open, opening and failed in words", () => {
    expect(rowLabel(base)).toEqual({ title: "Login", detail: "Closed", tone: "muted" });
    expect(rowLabel({ ...base, status: "running" })).toEqual({
      title: "Login",
      detail: "Open",
      tone: "muted",
    });
    expect(rowLabel({ ...base, status: "starting" })).toEqual({
      title: "Login",
      detail: "Opening...",
      tone: "muted",
    });
    expect(rowLabel({ ...base, status: "failed", error: "Bridge stopped: exited with 3" })).toEqual(
      { title: "Login", detail: "Bridge stopped: exited with 3", tone: "danger" },
    );
  });
  it("marks a file whose variables differ from design/tokens.json", () => {
    expect(rowLabel({ ...base, status: "running", outOfStep: true })).toEqual({
      title: "Login",
      detail: "Open · tokens differ from design/tokens.json",
      tone: "warning",
    });
  });
});

describe("tokensBanner", () => {
  it("says nothing when the tokens loaded cleanly or there are none", () => {
    expect(tokensBanner(null, false)).toBeNull();
    expect(tokensBanner({ status: "none" }, false)).toBeNull();
    expect(tokensBanner({ status: "imported", warnings: [] }, false)).toBeNull();
  });
  it("says when the file uses Paseo's tokens", () => {
    expect(tokensBanner({ status: "default" }, false)).toEqual({
      text: "Paseo's tokens: this repo has no design/tokens.json",
      tone: "muted",
    });
  });
  it("names what kept tokens out, and a write-back", () => {
    expect(tokensBanner({ status: "refused", reason: "x: no $type" }, false)).toEqual({
      text: "Tokens not loaded: x: no $type",
      tone: "warning",
    });
    expect(
      tokensBanner(
        { status: "imported", warnings: ["shadow.card: shadow tokens stay", "b"] },
        false,
      ),
    ).toEqual({
      text: "2 tokens kept out of FigCraft: shadow.card: shadow tokens stay",
      tone: "muted",
    });
    expect(tokensBanner({ status: "imported", warnings: ["one"] }, false)?.text).toBe(
      "1 token kept out of FigCraft: one",
    );
    expect(tokensBanner({ status: "imported", warnings: [] }, true)).toEqual({
      text: "Token edits written to design/tokens.json, not committed",
      tone: "muted",
    });
  });
});

describe("hasTouchScreen", () => {
  it("is true on a phone or tablet app, and on web only with a coarse pointer or touch points", () => {
    expect(hasTouchScreen("android", null)).toBe(true);
    expect(hasTouchScreen("web", null)).toBe(false);
    expect(hasTouchScreen("web", { anyCoarse: false, touchPoints: 0 })).toBe(false);
    expect(hasTouchScreen("web", { anyCoarse: true, touchPoints: 0 })).toBe(true);
  });
});
