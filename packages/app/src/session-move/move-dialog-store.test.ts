import { afterEach, describe, expect, it } from "vitest";
import {
  closeMoveDialog,
  openMoveDialog,
  selectMoveDialogRequest,
  useMoveDialogStore,
  type MoveDialogScope,
} from "./move-dialog-store";

function requestFor(scope: MoveDialogScope) {
  return selectMoveDialogRequest(useMoveDialogStore.getState(), scope);
}

describe("move dialog store", () => {
  afterEach(() => {
    closeMoveDialog();
  });

  it("shows a request on the workspace that opened it", () => {
    openMoveDialog({ serverId: "host-a", workspaceId: "w1", agentId: "agent-1" });
    expect(requestFor({ serverId: "host-a", workspaceId: "w1" })).toEqual({
      serverId: "host-a",
      workspaceId: "w1",
      agentId: "agent-1",
    });
  });

  it("does not show it on another workspace of the host, or on the same workspace id of another host", () => {
    openMoveDialog({ serverId: "host-a", workspaceId: "w1", agentId: "agent-1" });
    expect(requestFor({ serverId: "host-a", workspaceId: "w2" })).toBeNull();
    expect(requestFor({ serverId: "host-b", workspaceId: "w1" })).toBeNull();
  });

  it("clears the request on close", () => {
    openMoveDialog({ serverId: "host-a", workspaceId: "w1", agentId: "agent-1" });
    closeMoveDialog();
    expect(requestFor({ serverId: "host-a", workspaceId: "w1" })).toBeNull();
  });
});
