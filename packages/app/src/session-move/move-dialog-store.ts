import { create } from "zustand";

/** The workspace screen a move dialog belongs to. */
export interface MoveDialogScope {
  serverId: string;
  workspaceId: string;
}

export interface MoveDialogRequest extends MoveDialogScope {
  agentId: string;
}

interface MoveDialogState {
  request: MoveDialogRequest | null;
}

/** One dialog for the whole app: the tab menu and the banner both open it for an agent. */
export const useMoveDialogStore = create<MoveDialogState>(() => ({ request: null }));

export function openMoveDialog(request: MoveDialogRequest): void {
  useMoveDialogStore.setState({ request });
}

export function closeMoveDialog(): void {
  useMoveDialogStore.setState({ request: null });
}

/**
 * The open request when it belongs to `scope`'s workspace, so another workspace screen that gains
 * focus does not show it. It shows again once its own screen is back in focus.
 */
export function selectMoveDialogRequest(
  state: MoveDialogState,
  scope: MoveDialogScope,
): MoveDialogRequest | null {
  const { request } = state;
  const isOwnWorkspace =
    request?.serverId === scope.serverId && request.workspaceId === scope.workspaceId;
  return isOwnWorkspace ? request : null;
}
