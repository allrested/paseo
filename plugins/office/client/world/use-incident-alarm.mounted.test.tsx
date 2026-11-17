/**
 * @vitest-environment jsdom
 */
// The open incidents on their way to the 3D office, mounted. The device's settings are the host's,
// so a stand-in holds them and records the saves; the scene records what it was sent.
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SettingsState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Incident, IncidentsState } from "../../shared/contracts.js";
import type { officeDeviceSettings } from "../../shared/settings.js";
import { useIncidentAlarm } from "./use-incident-alarm.js";
import type { WorldApi, WorldIncident } from "./world-api.js";

type DeviceSettings = SettingsState<typeof officeDeviceSettings.schema>;
type DeviceValues = Extract<DeviceSettings, { status: "ready" }>["values"];
type Stored = { status: "loading" } | { status: "ready"; values: DeviceValues; revision: string };

interface Saved {
  values: DeviceValues;
  revision: string;
}

const NOW = Date.parse("2026-11-17T09:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let stored: Stored;
let saved: Saved[];
/** Set to refuse the next save, as when another save moved the revision first. */
let movedBy: Stored | null;

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: (): DeviceSettings => ({
    ...stored,
    saving: false,
    saveError: null,
    save: async (values: DeviceValues, revision: string) => {
      if (movedBy !== null) return false;
      saved.push({ values, revision });
      stored = { status: "ready", values, revision: `r${saved.length + 1}` };
      return true;
    },
    reset: async () => true,
    reload: async () => {
      if (movedBy !== null) stored = movedBy;
      movedBy = null;
    },
  }),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let sent: WorldIncident[][];
const scene = {
  setIncidents: (list: readonly WorldIncident[]) => sent.push([...list]),
} as unknown as WorldApi;

function incident(key: string, title: string, foundAt: number): Incident {
  return {
    id: `jira:${key}`,
    source: "jira",
    key,
    title,
    url: `https://example.atlassian.net/browse/${key}`,
    createdAt: foundAt - HOUR,
    foundAt,
  };
}

const older = incident("SHOP-12", "Checkout fails on Safari", NOW - HOUR);
const newer = incident("SHOP-13", "Payments time out", NOW);

function state(open: Incident[]): IncidentsState {
  return { open, problems: {}, jiraReady: true, sentryReady: false, scheduleError: null };
}

function ready(rungIncidents: Record<string, number>, revision = "r1"): Stored {
  return { status: "ready", values: { threeD: true, view: "3d", rungIncidents }, revision };
}

interface HarnessProps {
  started: boolean;
  incidents: IncidentsState | undefined;
}

function Harness({ started, incidents }: HarnessProps) {
  const world = useRef<WorldApi | null>(scene);
  useIncidentAlarm({ world, started, incidents });
  return null;
}

let root: Root;
let container: HTMLElement;

async function show(props: HarnessProps): Promise<void> {
  await act(async () => {
    root.render(<Harness {...props} />);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  stored = ready({});
  saved = [];
  movedBy = null;
  sent = [];
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

test("nothing goes to the scene before the device's map is read; then the incident not rung rings and the map is saved", async () => {
  stored = { status: "loading" };
  await show({ started: true, incidents: state([older, newer]) });
  expect(sent).toEqual([]);

  stored = ready({ [older.id]: NOW - HOUR });
  await show({ started: true, incidents: state([older, newer]) });

  expect(sent).toEqual([
    [
      { id: newer.id, key: "SHOP-13", title: "Payments time out", ring: true },
      { id: older.id, key: "SHOP-12", title: "Checkout fails on Safari", ring: false },
    ],
  ]);
  expect(saved).toEqual([
    {
      values: {
        threeD: true,
        view: "3d",
        rungIncidents: { [older.id]: NOW - HOUR, [newer.id]: NOW },
      },
      revision: "r1",
    },
  ]);
});

test("nothing goes to the scene before it started, nor from a host without incidents", async () => {
  await show({ started: false, incidents: state([older]) });
  await show({ started: true, incidents: undefined });
  expect(sent).toEqual([]);
  expect(saved).toEqual([]);
});

test("a new snapshot rings only what is new; the same incidents again ring and save nothing", async () => {
  await show({ started: true, incidents: state([older]) });
  await show({ started: true, incidents: state([older]) });
  await show({ started: true, incidents: state([older, newer]) });

  expect(sent.map((list) => list.map(({ key, ring }) => [key, ring]))).toEqual([
    [["SHOP-12", true]],
    [["SHOP-12", false]],
    [
      ["SHOP-13", true],
      ["SHOP-12", false],
    ],
  ]);
  expect(saved.map(({ values }) => values.rungIncidents)).toEqual([
    { [older.id]: NOW },
    { [older.id]: NOW, [newer.id]: NOW },
  ]);
});

test("the office opened again reads the saved map and rings nothing", async () => {
  await show({ started: true, incidents: state([older]) });
  act(() => root.unmount());
  root = createRoot(container);
  await show({ started: true, incidents: state([older]) });

  expect(sent.map((list) => list.map(({ ring }) => ring))).toEqual([[true], [false]]);
  expect(saved).toHaveLength(1);
});

test("an entry over 2 days old is dropped and saved though nothing rang", async () => {
  stored = ready({ "jira:SHOP-1": NOW - 3 * DAY });
  await show({ started: true, incidents: state([]) });

  expect(sent).toEqual([[]]);
  expect(saved).toEqual([
    { values: { threeD: true, view: "3d", rungIncidents: {} }, revision: "r1" },
  ]);
});

test("a save refused because the view was saved first is saved again over the new view", async () => {
  movedBy = {
    status: "ready",
    values: { threeD: true, view: "2d", rungIncidents: {} },
    revision: "r9",
  };
  await show({ started: true, incidents: state([older]) });
  await show({ started: true, incidents: state([older]) });

  expect(saved).toEqual([
    { values: { threeD: true, view: "2d", rungIncidents: { [older.id]: NOW } }, revision: "r9" },
  ]);
});
