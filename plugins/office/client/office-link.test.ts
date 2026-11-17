// @vitest-environment jsdom
// The channel between a panel and the office surface beside it, mounted: a panel calls the
// surface that is there, and opens the agent's workspace when no surface is.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  ACTIVITY_SCREEN,
  SESSIONS_SCREEN,
  linkOpenSession,
  linkSelect,
  useOfficeLink,
  type OfficeLink,
} from "./office-link.js";

type Navigation = PluginSurfaceProps["navigation"];

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

interface Seat {
  root: Root;
  calls: string[];
}

let seats: Seat[] = [];

/** One place in the office's tree registering the link: the surface, and in a test, a second. */
function Registered({ link }: { link: OfficeLink }) {
  useOfficeLink(link);
  return null;
}

function register(prefix: string): Seat {
  const calls: string[] = [];
  const link: OfficeLink = {
    select: (agentId) => void calls.push(`${prefix} select ${agentId}`),
    openSession: (agentId) => void calls.push(`${prefix} openSession ${agentId}`),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Registered, { link })));
  const seat = { root, calls };
  seats.push(seat);
  return seat;
}

function unmount(seat: Seat): void {
  act(() => seat.root.unmount());
  seats = seats.filter((each) => each !== seat);
}

afterEach(() => {
  for (const seat of seats) act(() => seat.root.unmount());
  seats = [];
  document.body.replaceChildren();
});

interface FakeNavigation {
  navigation: NonNullable<Navigation>;
  opened: Array<{ agentId: string }>;
}

/** The app's navigation, with a side area when `beside` is given. */
function fakeNavigation(): FakeNavigation {
  const opened: Array<{ agentId: string }> = [];
  const navigation: NonNullable<Navigation> = {
    openAgent: (input) => void opened.push(input),
    openWorkspace: () => undefined,
    showBeside: () => true,
  };
  return { navigation, opened };
}

test("a panel selects on the registered surface", () => {
  const surface = register("surface");
  const { navigation, opened } = fakeNavigation();

  linkSelect("a1", navigation);

  expect(surface.calls).toEqual(["surface select a1"]);
  expect(opened).toEqual([]);
});

test("a panel opens a session on the registered surface", () => {
  const surface = register("surface");
  const { navigation, opened } = fakeNavigation();

  linkOpenSession("a1", navigation);

  expect(surface.calls).toEqual(["surface openSession a1"]);
  expect(opened).toEqual([]);
});

test("with no surface, a row opens the agent's workspace", () => {
  const { navigation, opened } = fakeNavigation();

  linkSelect("a1", navigation);

  expect(opened).toEqual([{ agentId: "a1" }]);
});

test("with no surface, a session opens the agent's workspace", () => {
  const { navigation, opened } = fakeNavigation();

  linkOpenSession("a1", navigation);

  expect(opened).toEqual([{ agentId: "a1" }]);
});

test("a panel with no navigation, and no surface, does nothing", () => {
  linkSelect("a1", undefined);
  linkOpenSession("a1", undefined);
  const surface = register("surface");

  linkSelect("a2", undefined);

  expect(surface.calls).toEqual(["surface select a2"]);
});

test("the last surface to mount wins; an old surface's unmount leaves the new one", () => {
  const first = register("first");
  // A 3D to List remount: the view that registered second is the one the panels reach.
  const second = register("second");
  const { navigation, opened } = fakeNavigation();

  linkSelect("a1", navigation);
  expect(first.calls).toEqual([]);
  expect(second.calls).toEqual(["second select a1"]);

  unmount(first);
  linkSelect("a2", navigation);
  expect(second.calls).toEqual(["second select a1", "second select a2"]);
  expect(opened).toEqual([]);

  // The last surface gone too: the panels open the agent's workspace again.
  unmount(second);
  linkSelect("a3", navigation);
  expect(opened).toEqual([{ agentId: "a3" }]);
});

test("the two screens' ids are the ones the office registers", () => {
  expect([SESSIONS_SCREEN, ACTIVITY_SCREEN]).toEqual(["office-sessions", "office-activity"]);
});
