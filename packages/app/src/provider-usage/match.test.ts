import { describe, expect, it } from "vitest";
import { matchProviderUsage } from "./match";
import type { ProviderUsage } from "./types";

function usage(providerId: string): ProviderUsage {
  return {
    providerId,
    displayName: providerId,
    status: "available",
    planLabel: null,
    windows: [],
  };
}

const providers = [usage("claude"), usage("bddevlab"), usage("opencode")];

describe("matchProviderUsage", () => {
  it("matches the active provider id, case-insensitively", () => {
    expect(matchProviderUsage(providers, "Claude", null)).toBe(providers[0]);
  });

  it("matches the model's gateway prefix when the provider itself has no usage entry", () => {
    expect(
      matchProviderUsage([providers[0], providers[1]], "opencode", "bddevlab/claude-opus-5"),
    ).toBe(providers[1]);
  });

  it("prefers the provider id over the model prefix", () => {
    expect(matchProviderUsage(providers, "opencode", "bddevlab/claude-opus-5")).toBe(providers[2]);
  });

  it("ignores a model with no gateway prefix", () => {
    expect(matchProviderUsage([providers[1]], "opencode", "claude-opus-5")).toBeNull();
  });

  it("returns null when neither the provider nor the model prefix has usage", () => {
    expect(matchProviderUsage(providers, "codex", "openai/gpt-5.5")).toBeNull();
    expect(matchProviderUsage(providers, null, null)).toBeNull();
  });
});
