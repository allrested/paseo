import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  findTargetByProvider,
  isSelectableTarget,
  type AgentMoveTargetsView,
} from "./move-targets";

/**
 * The model to move an agent onto: the one the user chose when the target offers it, else the
 * target's default. Undefined when the target's models are unknown, so the host picks its default.
 */
export function resolveMoveModelId(
  provider: ProviderSelectorProvider | null,
  chosenModelId: string | null,
): string | undefined {
  if (provider?.modelSelection.kind !== "models") return undefined;
  const { rows } = provider.modelSelection;
  const chosen = chosenModelId ? rows.find((row) => row.modelId === chosenModelId) : undefined;
  const model = chosen ?? rows.find((row) => row.isDefault) ?? rows[0];
  return model?.modelId || undefined;
}

/** What the user has chosen in the move dialog. */
export interface MoveFormState {
  provider: string | null;
  chosenModelId: string | null;
  continueWork: boolean;
}

export type MoveFormAction =
  | { type: "select-target"; provider: string }
  | { type: "select-model"; modelId: string }
  | { type: "set-continue"; continueWork: boolean };

export const INITIAL_MOVE_FORM: MoveFormState = {
  provider: null,
  chosenModelId: null,
  continueWork: true,
};

export function moveFormReducer(state: MoveFormState, action: MoveFormAction): MoveFormState {
  switch (action.type) {
    case "select-target":
      // A model belongs to its provider, so another target starts from its own default.
      return { ...state, provider: action.provider, chosenModelId: null };
    case "select-model":
      return { ...state, chosenModelId: action.modelId };
    case "set-continue":
      return { ...state, continueWork: action.continueWork };
  }
}

export interface MoveRequest {
  target: AgentMoveTarget;
  model: string | undefined;
  continueWork: boolean;
}

/**
 * The move the dialog would send now, or null while there is none: the chosen target has to be in
 * the latest list and selectable. The targets and the target's provider snapshot load late, so they
 * come in as arguments instead of living in the form.
 */
export function resolveMoveSubmission(input: {
  form: MoveFormState;
  targets: AgentMoveTargetsView;
  provider: ProviderSelectorProvider | null;
}): MoveRequest | null {
  const { form } = input;
  const target = findTargetByProvider(input.targets, form.provider);
  if (!target || !isSelectableTarget(target)) return null;
  return {
    target,
    model: resolveMoveModelId(input.provider, form.chosenModelId),
    continueWork: form.continueWork,
  };
}
