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
  claimOfficeLink,
  linkSelect,
  useOfficeLink,
  type OfficeLink,
} from "./office-link.js";

type Navigation = PluginSurfaceProps["navigation"];

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

interface Seat {
  root: Root;
  link: OfficeLink;
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
  const seat = { root, link, calls };
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

/**
 * The app's navigation as a panel gets it. In the side area it has no `showBeside`; on the
 * screen's own route (`ownRoute`) it has one.
 */
function fakeNavigation(ownRoute = false): FakeNavigation {
  const opened: Array<{ agentId: string }> = [];
  const navigation: NonNullable<Navigation> = {
    openAgent: (input) => void opened.push(input),
    openWorkspace: () => undefined,
    ...(ownRoute ? { showBeside: () => true } : {}),
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

test("on its own route, a row opens the workspace even with a surface registered", () => {
  // "Open Sessions" pushed the screen's route over the office, which stays mounted and registered.
  const surface = register("surface");
  const { navigation, opened } = fakeNavigation(true);

  linkSelect("a1", navigation);
  linkOpenSession("a2", navigation);

  expect(surface.calls).toEqual([]);
  expect(opened).toEqual([{ agentId: "a1" }, { agentId: "a2" }]);
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

test("the surface that opens a panel claims the link from a later one", () => {
  // Two offices mounted (a retained deck): the earlier one's header button opened the panel.
  const earlier = register("earlier");
  const later = register("later");
  const { navigation } = fakeNavigation();

  claimOfficeLink(earlier.link);
  linkSelect("a1", navigation);
  expect(earlier.calls).toEqual(["earlier select a1"]);
  expect(later.calls).toEqual([]);

  // The later office leaving does not clear the claimer's registration.
  unmount(later);
  linkOpenSession("a2", navigation);
  expect(earlier.calls).toEqual(["earlier select a1", "earlier openSession a2"]);
});

test("the two screens' ids are the ones the office registers", () => {
  expect([SESSIONS_SCREEN, ACTIVITY_SCREEN]).toEqual(["office-sessions", "office-activity"]);
});
