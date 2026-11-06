import { describe, expect, it } from "vitest";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  INITIAL_MOVE_FORM,
  moveFormReducer,
  resolveMoveModelId,
  resolveMoveSubmission,
  type MoveFormState,
} from "./move-model";
import type { AgentMoveTargetsView } from "./move-targets";

function provider(
  rows: { modelId: string; isDefault?: boolean }[] | "loading",
): ProviderSelectorProvider {
  return {
    id: "codex",
    label: "Codex",
    modelSelection:
      rows === "loading"
        ? { kind: "loading" }
        : {
            kind: "models",
            rows: rows.map((row) => ({
              favoriteKey: `codex:${row.modelId}`,
              provider: "codex",
              providerLabel: "Codex",
              modelId: row.modelId,
              modelLabel: row.modelId,
              isDefault: row.isDefault,
            })),
          },
  };
}

describe("resolveMoveModelId", () => {
  const models = provider([{ modelId: "gpt-a" }, { modelId: "gpt-b", isDefault: true }]);

  it("defaults to the provider's default model", () => {
    expect(resolveMoveModelId(models, null)).toBe("gpt-b");
  });

  it("falls back to the first model when none is marked default", () => {
    expect(resolveMoveModelId(provider([{ modelId: "gpt-a" }, { modelId: "gpt-b" }]), null)).toBe(
      "gpt-a",
    );
  });

  it("uses the chosen model when the provider offers it", () => {
    expect(resolveMoveModelId(models, "gpt-a")).toBe("gpt-a");
  });

  it("ignores a chosen model the provider does not offer", () => {
    expect(resolveMoveModelId(models, "claude-x")).toBe("gpt-b");
  });

  it("omits the model when the provider's models are unknown", () => {
    expect(resolveMoveModelId(null, null)).toBeUndefined();
    expect(resolveMoveModelId(provider("loading"), "gpt-a")).toBeUndefined();
  });

  it("omits the model when the only row is the synthetic default", () => {
    expect(resolveMoveModelId(provider([{ modelId: "", isDefault: true }]), null)).toBeUndefined();
  });
});

describe("moveFormReducer", () => {
  it("continues the work by default", () => {
    expect(INITIAL_MOVE_FORM).toEqual({ provider: null, chosenModelId: null, continueWork: true });
  });

  it("forgets the chosen model when another target is selected", () => {
    const chosen: MoveFormState = { provider: "codex", chosenModelId: "gpt-a", continueWork: true };
    expect(moveFormReducer(chosen, { type: "select-target", provider: "claude" })).toEqual({
      provider: "claude",
      chosenModelId: null,
      continueWork: true,
    });
  });

  it("keeps the target when a model is chosen", () => {
    const selected = moveFormReducer(INITIAL_MOVE_FORM, {
      type: "select-target",
      provider: "codex",
    });
    expect(moveFormReducer(selected, { type: "select-model", modelId: "gpt-a" })).toEqual({
      provider: "codex",
      chosenModelId: "gpt-a",
      continueWork: true,
    });
  });

  it("sets whether the moved agent continues", () => {
    expect(
      moveFormReducer(INITIAL_MOVE_FORM, { type: "set-continue", continueWork: false }),
    ).toEqual({ provider: null, chosenModelId: null, continueWork: false });
  });
});

describe("resolveMoveSubmission", () => {
  function target(overrides: Partial<AgentMoveTarget> & { provider: string }): AgentMoveTarget {
    return {
      label: overrides.provider,
      family: overrides.provider,
      available: true,
      current: false,
      usedPct: null,
      resetsAt: null,
      ...overrides,
    };
  }

  const codex = target({ provider: "codex" });
  const ready: AgentMoveTargetsView = {
    kind: "ready",
    targets: [
      codex,
      target({ provider: "claude", current: true }),
      target({ provider: "gemini", available: false }),
    ],
  };
  const models = provider([{ modelId: "gpt-a" }, { modelId: "gpt-b", isDefault: true }]);

  function form(overrides: Partial<MoveFormState>): MoveFormState {
    return { ...INITIAL_MOVE_FORM, ...overrides };
  }

  it("moves to the selected target with the chosen model", () => {
    expect(
      resolveMoveSubmission({
        form: form({ provider: "codex", chosenModelId: "gpt-a", continueWork: false }),
        targets: ready,
        provider: models,
      }),
    ).toEqual({ target: codex, model: "gpt-a", continueWork: false });
  });

  it("uses the target's default model when it does not offer the chosen one", () => {
    expect(
      resolveMoveSubmission({
        form: form({ provider: "codex", chosenModelId: "claude-x" }),
        targets: ready,
        provider: models,
      }),
    ).toEqual({ target: codex, model: "gpt-b", continueWork: true });
  });

  it("has nothing to submit without a selectable target that is still listed", () => {
    const refused: { form: MoveFormState; targets: AgentMoveTargetsView }[] = [
      { form: INITIAL_MOVE_FORM, targets: ready },
      { form: form({ provider: "opencode" }), targets: ready },
      { form: form({ provider: "claude" }), targets: ready },
      { form: form({ provider: "gemini" }), targets: ready },
      { form: form({ provider: "codex" }), targets: { kind: "loading" } },
      { form: form({ provider: "codex" }), targets: { kind: "disconnected" } },
    ];
    expect(refused.map((input) => resolveMoveSubmission({ ...input, provider: models }))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
