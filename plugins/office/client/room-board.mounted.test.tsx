/**
 * @vitest-environment jsdom
 */
// A room card's board, mounted: the lobby's previews its open to-dos, a workspace's its posts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeSnapshot, Post } from "../shared/contracts.js";
import { buildOfficeModel, type OfficeRoom } from "../shared/model.js";
import { RoomBoard } from "./room-board.js";
import { useOfficeStyles } from "./styles.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function post(seq: number, board: string, fields: Partial<Post>): Post {
  const at = `2026-11-17T09:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `p${seq}`,
    seq,
    board,
    kind: "task",
    text: `Post ${seq}`,
    author: "user",
    state: "open",
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

function officeRoom(id: string, boards: OfficeSnapshot["boards"]): OfficeRoom {
  const snapshot: OfficeSnapshot = {
    agents: [],
    workspaces: [{ id: "w1", name: "shop-api", projectName: "shop" }],
    activity: {},
    boards,
    wake: { paused: false, queued: {} },
  };
  const room = buildOfficeModel(snapshot).rooms.find((candidate) => candidate.id === id);
  if (!room) throw new Error(`No room ${id}`);
  return room;
}

const nameOf = (author: string) => author;
const ignore = () => undefined;

function Harness({ room }: { room: OfficeRoom }) {
  const styles = useOfficeStyles(THEME, false, false);
  return <RoomBoard room={room} name={nameOf} styles={styles} onOpenBoard={ignore} />;
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (room: OfficeRoom) => act(async () => root.render(<Harness room={room} />));

/** Every line of text the card shows, in order; the button's hidden width spacer is left out. */
function lines(): string[] {
  return [...container.querySelectorAll("*")]
    .filter((element) => element.childElementCount === 0 && element.textContent !== "")
    .filter((element) => element.closest('[aria-hidden="true"]') === null)
    .map((element) => element.textContent ?? "");
}

test("the lobby card previews open to-dos and counts only open ones", async () => {
  await mount(
    officeRoom("lobby", {
      lobby: [
        post(1, "lobby", { text: "Done first", state: "done" }),
        post(2, "lobby", { text: "Done second", state: "done" }),
        post(3, "lobby", { text: "Rotate the keys" }),
        post(4, "lobby", { text: "Check the build", state: "claimed", claimedBy: "a1" }),
        post(5, "lobby", { text: "Update the README" }),
        post(6, "lobby", { text: "Tag the release" }),
        post(7, "lobby", { text: "Send the notes" }),
        post(8, "lobby", { kind: "note", text: "Demo moved", state: undefined }),
      ],
    }),
  );

  expect(lines()).toEqual([
    "To-do",
    "Open board",
    "Task · open · user",
    "Rotate the keys",
    "Task · claimed by a1 · user",
    "Check the build",
    "Task · open · user",
    "Update the README",
    "2 more",
  ]);

  await mount(
    officeRoom("lobby", {
      lobby: [
        post(1, "lobby", { text: "Done first", state: "done" }),
        post(2, "lobby", { kind: "note", text: "Demo moved", state: undefined }),
      ],
    }),
  );

  expect(lines()).toEqual(["To-do", "No to-dos", "Open board"]);
});

test("a workspace card still previews its posts", async () => {
  await mount(
    officeRoom("w1", {
      w1: [
        post(1, "w1", { text: "Done first", state: "done" }),
        post(2, "w1", { kind: "note", text: "Demo moved", state: undefined }),
        post(3, "w1", { text: "Rotate the keys" }),
        post(4, "w1", { text: "Check the build" }),
        post(5, "w1", { text: "Update the README" }),
      ],
    }),
  );

  expect(lines()).toEqual([
    "Board",
    "Open board",
    "Task · open · user",
    "Rotate the keys",
    "Task · open · user",
    "Check the build",
    "Task · open · user",
    "Update the README",
    "1 more",
  ]);

  await mount(officeRoom("w1", {}));

  expect(lines()).toEqual(["Board", "No posts", "Open board"]);
});
