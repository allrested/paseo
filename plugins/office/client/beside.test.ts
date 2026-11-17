import { expect, test } from "vitest";
import type { PluginBesideTarget, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openSessionWith, resourcesOpener } from "./beside.js";

type Navigation = NonNullable<PluginSurfaceProps["navigation"]>;

interface FakeNavigation {
  navigation: Navigation;
  shown: PluginBesideTarget[];
  opened: string[];
}

/** The app's navigation; `answer` is what its side area says, null when the app has none. */
function fakeNavigation(answer: boolean | null): FakeNavigation {
  const shown: PluginBesideTarget[] = [];
  const opened: string[] = [];
  const navigation: Navigation = {
    openAgent: ({ agentId }) => {
      opened.push(agentId);
    },
    openWorkspace: () => {},
    ...(answer === null
      ? {}
      : {
          showBeside: (target: PluginBesideTarget) => {
            shown.push(target);
            return answer;
          },
        }),
  };
  return { navigation, shown, opened };
}

test("a session shown beside the floor does not leave the office", () => {
  const fake = fakeNavigation(true);
  const beside = openSessionWith(fake.navigation, "a1");
  expect(beside).toBe(true);
  expect(fake.shown).toEqual([{ kind: "agent", agentId: "a1" }]);
  expect(fake.opened).toEqual([]);
});

test("a session the side area cannot show opens in its workspace", () => {
  const fake = fakeNavigation(false);
  const beside = openSessionWith(fake.navigation, "a1");
  expect(beside).toBe(false);
  expect(fake.shown).toEqual([{ kind: "agent", agentId: "a1" }]);
  expect(fake.opened).toEqual(["a1"]);
});

test("an app without a side area opens the session in its workspace", () => {
  const fake = fakeNavigation(null);
  const beside = openSessionWith(fake.navigation, "a1");
  expect(beside).toBe(false);
  expect(fake.opened).toEqual(["a1"]);
});

test("without navigation a session opens nowhere", () => {
  expect(openSessionWith(undefined, "a1")).toBe(false);
});

test("an app without a side area leaves the wall screen to the Host card", () => {
  let machineOpened = 0;
  const open = resourcesOpener(fakeNavigation(null).navigation, () => {
    machineOpened += 1;
  });
  expect(open).toBeUndefined();
  expect(resourcesOpener(undefined, () => {})).toBeUndefined();
  expect(machineOpened).toBe(0);
});

test("the wall screen shows Resources beside the floor", () => {
  const fake = fakeNavigation(true);
  let machineOpened = 0;
  const open = resourcesOpener(fake.navigation, () => {
    machineOpened += 1;
  });
  open?.();
  expect(fake.shown).toEqual([
    { kind: "screen", pluginId: "resource-manager", screenId: "resources" },
  ]);
  expect(machineOpened).toBe(0);
});

test("the wall screen opens the Host card when the side area cannot show Resources", () => {
  const fake = fakeNavigation(false);
  let machineOpened = 0;
  const open = resourcesOpener(fake.navigation, () => {
    machineOpened += 1;
  });
  open?.();
  expect(fake.shown).toHaveLength(1);
  expect(machineOpened).toBe(1);
  expect(fake.opened).toEqual([]);
});
