// @vitest-environment jsdom
// Paseo's entry to the 3D office (paseo-entry.js), driven through the API the plugin calls. The
// upstream modules it imports draw on a canvas or WebGL as they load, which a test has not: each
// is stood in with the little the entry reads. An upstream rule a test is about is copied into
// its stand-in, with where it comes from.
import { beforeEach, expect, test, vi } from "vitest";
import { state } from "../../vendor/my-office/src/office/core/state.js";
import { openWorldFrame } from "./world-frame.web.js";

const h = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  workers: new Map<string, Record<string, unknown>>(),
  applauded: [] as string[],
  played: [] as string[],
  incidentsOpened: 0,
  /** The camera bar's markup is in the page. */
  built: false,
  /** Whether it was when the first of the scene's modules started (ui/photo.js wires it then). */
  builtBeforeModules: null as boolean | null,
  closePlace: vi.fn(),
}));

vi.mock("../../vendor/my-office/src/office/paseo-modules.js", () => ({
  MODULES: [
    [
      "probe",
      {
        setup() {
          h.builtBeforeModules ??= h.built;
        },
      },
    ],
  ],
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  renderer: { domElement: document.createElement("canvas"), dispose() {}, forceContextLoss() {} },
}));
vi.mock("../../vendor/my-office/src/office/scene/blocks.js", () => ({ canvasTex: () => null }));
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({ focusTarget: null }));
vi.mock("../../vendor/my-office/src/office/net/live.js", () => ({
  teamTags: [],
  setupTeams() {},
  projOf: () => "",
  upsertSession: (s: { id: string }) => h.sessions.set(s.id, s),
  removeSession: (id: string) => h.sessions.delete(id),
}));
vi.mock("../../vendor/my-office/src/office/ui/whiteboard.js", () => ({ setup() {} }));
vi.mock("../../vendor/my-office/src/office/world/backdrops/index.js", () => ({
  setup() {},
  applyNight() {},
}));
vi.mock("../../vendor/my-office/src/office/ui/camera-bar.js", () => ({
  build() {
    h.built = true;
  },
  setup() {},
}));
vi.mock("../../vendor/my-office/src/office/ui/event-text.js", () => ({
  ACT: { other: {} },
  bubbleText: () => "",
}));
vi.mock("../../vendor/my-office/src/office/ui/icons.js", () => ({
  TYPE_ICON: {},
  icon: () => null,
}));
vi.mock("../../vendor/my-office/src/office/ui/session-drawer.js", () => ({
  openSession() {},
  closeSession() {},
}));
vi.mock("../../vendor/my-office/src/office/interact/place-chips.js", () => ({ PLACES: {} }));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({ PROPS: new Map() }));
vi.mock("../../vendor/my-office/src/office/interact/place-cards.js", () => ({
  closePlace: h.closePlace,
}));
vi.mock("../../vendor/my-office/src/office/world/pro/pieces.js", () => ({
  OFFICE_MARK: "",
  PRO_FX: {},
}));
vi.mock("../../vendor/my-office/src/office/paseo-leisure.js", () => ({
  ringWithEveryone: (ring: () => unknown) => ring(),
  updateLeisure() {},
}));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: h.sessions,
  workers: h.workers,
  subs: new Map(),
  dropSub() {},
  spawnSub() {},
  subAct() {},
}));
vi.mock("../../vendor/my-office/src/office/people/director.js", () => ({ director: null }));
vi.mock("../../vendor/my-office/src/office/people/navigation.js", () => ({ STATIONS: {} }));
vi.mock("../../vendor/my-office/src/office/people/gatherings.js", async () => {
  const scene = await import("../../vendor/my-office/src/office/core/state.js");
  return {
    ringBell() {},
    // Upstream's applause cheers someone once per 600 s of scene time (people/gatherings.js applaud).
    applaud(sess: string) {
      const w = h.workers.get(sess) as { cheeredAt?: number } | undefined;
      if (!w || scene.state.sim - (w.cheeredAt ?? -1e9) < 600) return;
      w.cheeredAt = scene.state.sim;
      h.applauded.push(sess);
    },
  };
});
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({ launchRocket() {} }));
vi.mock("../../vendor/my-office/src/office/world/props/printer.js", () => ({ printPage() {} }));
vi.mock("../../vendor/my-office/src/office/world/props/dev-servers.js", () => ({
  lostObj: null,
  syncDevBoxes() {},
}));
vi.mock("../../vendor/my-office/src/office/world/props/shredder.js", () => ({
  shredAction: (_w: unknown, a: unknown) => a,
}));
vi.mock("../../vendor/my-office/src/office/life/tests.js", () => ({ clearRun() {}, onTest() {} }));
vi.mock("../../vendor/my-office/src/office/life/your-turn.js", () => ({ onTurnDone() {} }));
// The sounds need a page's audio: the test hears which one played.
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({
  sfx: { play: (name: string) => h.played.push(name) },
  setup() {},
}));

// The entry sets the API on the window as it loads.
await import("../../vendor/my-office/src/office/paseo-entry.js");
const { updateIncident } = await import("../../vendor/my-office/src/office/life/incidents.js");
const { host } = await import("../../vendor/my-office/src/office/paseo-host.js");

interface World {
  start(options?: object): void;
  setSessions(list: object[]): void;
  event(e: { sess: string; type: string }): void;
  setIncidents(list: object[]): void;
  setMachine(machine: object | null): void;
}
const world = (globalThis as unknown as { PaseoOfficeWorld: World }).PaseoOfficeWorld;
world.start({
  brand: { name: "Acme" },
  onIncidents: () => {
    h.incidentsOpened += 1;
  },
});

const session = (id: string) => ({
  id,
  name: id,
  title: id,
  dir: "team",
  git: { repo: "team" },
  status: "rest",
  agent: "claude",
  lastPrompt: "",
  stuck: false,
  subs: [],
});

/** An element of the page the entry built. */
function page(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The page has no #${id}`);
  return found;
}

/** An open incident as Paseo sends it, newest first; `ring` where this device has not rung for it. */
function incident(key: string, title: string, ring: boolean) {
  return { id: `jira:${key}`, key, title, ring };
}

/** Someone at a desk: a session the scene knows and the person drawn for it. */
function seat(id: string) {
  world.setSessions([session(id)]);
  h.workers.set(id, { id, push() {} });
}

beforeEach(() => {
  h.sessions.clear();
  h.workers.clear();
  h.applauded.length = 0;
  h.played.length = 0;
  h.incidentsOpened = 0;
  state.sim = 0;
  state.incidentUntil = 0;
  world.setIncidents([]);
  page("stage-wrap").classList.remove("is-incident");
});

test("a deploy that succeeded is applauded, also right after a push or another deploy", () => {
  seat("a");
  state.sim = 100;
  world.event({ sess: "a", type: "push" });
  state.sim = 160;
  world.event({ sess: "a", type: "deploy" });
  state.sim = 220;
  world.event({ sess: "a", type: "deploy" });

  expect(h.applauded).toEqual(["a", "a", "a"]);
});

test("a push is applauded once in ten minutes, as upstream has it", () => {
  seat("a");
  state.sim = 100;
  world.event({ sess: "a", type: "push" });
  state.sim = 160;
  world.event({ sess: "a", type: "push" });

  expect(h.applauded).toEqual(["a"]);
});

test("a new list of sessions keeps the last event the scene saw of each person, and its time", () => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  try {
    seat("a");
    world.event({ sess: "a", type: "stop" });
    world.setSessions([{ ...session("a"), doneAt: 1_699_999_000_000 }]);

    expect(h.sessions.get("a")).toMatchObject({
      lastAt: 1_700_000_000_000,
      last: { type: "stop" },
      doneAt: 1_699_999_000_000,
    });
  } finally {
    vi.useRealTimers();
  }
});

test("an agent stopped on an error keeps no time of its last event, so it stays in sight at night", () => {
  world.setSessions([{ ...session("a"), stuck: true }]);
  h.workers.set("a", { id: "a", push() {} });
  world.event({ sess: "a", type: "fail" });
  world.setSessions([{ ...session("a"), stuck: true }]);

  expect(h.sessions.get("a")).toMatchObject({ last: { type: "fail" } });
  expect(h.sessions.get("a")).not.toHaveProperty("lastAt");
});

test("an incident that rings starts the alarm once: 25 s of red, a fail bubble over each person at work, the siren", () => {
  world.setSessions([{ ...session("a"), status: "work" }, session("b")]);
  const pushed: Record<string, unknown[]> = { a: [], b: [] };
  h.workers.set("a", { id: "a", push: (act: unknown) => pushed.a?.push(act) });
  h.workers.set("b", { id: "b", push: (act: unknown) => pushed.b?.push(act) });
  state.sim = 100;
  // Two new at once ring once.
  world.setIncidents([
    incident("SHOP-13", "Payments time out", true),
    incident("SHOP-12", "Checkout fails on Safari", true),
  ]);

  expect(state.incidentUntil).toBe(125);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(true);
  expect(h.played).toEqual(["siren"]);
  expect(pushed).toEqual({ a: [{ type: "fail", text: "Incident!" }], b: [] });

  // The same incidents again, rung for already: nothing rings.
  world.setIncidents([
    incident("SHOP-13", "Payments time out", false),
    incident("SHOP-12", "Checkout fails on Safari", false),
  ]);
  expect(h.played).toEqual(["siren"]);
  expect(pushed.a).toHaveLength(1);
});

test("an incident rung for already shows on the banner and rings nothing", () => {
  state.sim = 100;
  world.setIncidents([incident("SHOP-12", "Checkout fails on Safari", false)]);

  expect(state.incidentUntil).toBe(0);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(false);
  expect(h.played).toEqual([]);
  expect(page("incident").hidden).toBe(false);
});

test("the red ends after 25 s and the banner stays while the incident is open", () => {
  state.sim = 100;
  world.setIncidents([incident("SHOP-12", "Checkout fails on Safari", true)]);
  state.sim = 124;
  updateIncident(state.sim);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(true);

  state.sim = 126;
  updateIncident(state.sim);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(false);
  expect(page("incident").hidden).toBe(false);
});

test("dismissing one incident leaves the red; dismissing every one ends it at once", () => {
  state.sim = 100;
  world.setIncidents([
    incident("SHOP-13", "Payments time out", true),
    incident("SHOP-12", "Checkout fails on Safari", true),
  ]);
  state.sim = 101;
  world.setIncidents([incident("SHOP-13", "Payments time out", false)]);
  updateIncident(state.sim);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(true);

  world.setIncidents([]);
  updateIncident(state.sim);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(false);
  expect(page("incident").hidden).toBe(true);
});

test("the banner names the newest incident and how many more; a click opens Paseo's Incidents card", () => {
  world.setIncidents([
    incident("SHOP-13", "Payments time out", false),
    incident("SHOP-12", "Checkout fails on Safari", false),
    incident("SHOP-11", "Search is slow", false),
  ]);
  expect(page("incident").hidden).toBe(false);
  expect(page("incident").textContent).toBe("Incident: SHOP-13 Payments time out · +2 more");

  page("incident").click();
  expect(h.incidentsOpened).toBe(1);

  world.setIncidents([incident("SHOP-13", "Payments time out", false)]);
  expect(page("incident").textContent).toBe("Incident: SHOP-13 Payments time out");

  world.setIncidents([]);
  expect(page("incident").hidden).toBe(true);
});

interface Prop {
  act(): void;
  /** The tooltip's line under the prop's name: interact/props.js's propHint gives it as it is for these props. */
  hint: string;
}

test("the camera bar is built before the scene's modules start", () => {
  // ui/photo.js, one of the modules, wires the bar's photo button as it starts.
  expect(h.builtBeforeModules).toBe(true);
});

test("the photo's mark carries the brand's name", () => {
  expect(host.brandName).toBe("Acme");
});

test("Escape in photo mode leaves the place card under it alone", () => {
  page("plc").hidden = false;
  document.body.classList.add("is-photo");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.closePlace).not.toHaveBeenCalled();

  document.body.classList.remove("is-photo");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.closePlace).toHaveBeenCalledTimes(1);
  page("plc").hidden = true;
});

/**
 * A page of its own, started with `options`, and its props. The page has a reading of the host, as `openMac()` reaches
 * Paseo's `onMachine` only then. A click on a prop runs its `act` (upstream's `activateProp`); a test calls it directly,
 * without the scene's picking. The entry starts once a page.
 */
async function startPage(options: object): Promise<Map<string, Prop>> {
  vi.resetModules();
  // Upstream's racks and wall screen open the machine panel (interact/props.js, prop('racks') and prop('tv')). The
  // stand-in is registered again for each page: resetModules keeps a mock's first module, and with it the first
  // page's host.
  vi.doMock("../../vendor/my-office/src/office/interact/props.js", async () => {
    const { openMac } = await import("../../vendor/my-office/src/office/ui/mac-drawer.js");
    const { t } = await import("../../vendor/my-office/src/i18n/index.js");
    return {
      PROPS: new Map([
        ["racks", { id: "racks", hint: t("props.racks.hint"), act: () => openMac() }],
        ["tv", { id: "tv", hint: t("props.tv.hint"), act: () => openMac() }],
      ]),
    };
  });
  // (three.js, which core/env.js loads, warns when it loads twice in one window: a page of its own loads it again)
  delete (window as { __THREE__?: string }).__THREE__;
  await import("../../vendor/my-office/src/office/paseo-entry.js");
  const fresh = (globalThis as unknown as { PaseoOfficeWorld: World }).PaseoOfficeWorld;
  fresh.start(options);
  fresh.setMachine({ mem: null, cpu: { percent: 0 }, devServers: [] });
  const { PROPS } = await import("../../vendor/my-office/src/office/interact/props.js");
  return PROPS as Map<string, Prop>;
}

test("the wall screen asks Paseo for Resources, and the racks still open the Host card", async () => {
  const resources = vi.fn();
  const machine = vi.fn();
  const props = await startPage({ onResources: resources, onMachine: machine });

  props.get("tv")?.act();
  expect(resources).toHaveBeenCalledTimes(1);
  expect(machine).not.toHaveBeenCalled();

  props.get("racks")?.act();
  expect(machine).toHaveBeenCalledTimes(1);
  expect(resources).toHaveBeenCalledTimes(1);
});

test("without Resources the wall screen opens the Host card", async () => {
  const machine = vi.fn();
  const props = await startPage({ onMachine: machine });

  props.get("tv")?.act();
  expect(machine).toHaveBeenCalledTimes(1);
});

test("the wall screen's tooltip says what it opens", async () => {
  const withResources = await startPage({ onResources() {}, onMachine() {} });
  expect(withResources.get("tv")?.hint).toBe("Open Resources");

  const without = await startPage({ onMachine() {} });
  expect(without.get("tv")?.hint).toBe("Open the Host panel");
});

test("the frame's page lets the office go full screen", () => {
  const container = document.createElement("div");
  const frame = openWorldFrame({ container, script: "", title: "Office in 3D" });

  expect(container.querySelector("iframe")?.getAttribute("allow")).toBe("fullscreen");
  frame.dispose();
});

test("onOpen is what the scene calls to open a person's session", async () => {
  const open = vi.fn();
  await startPage({ onOpen: open });
  const { host: fresh } = await import("../../vendor/my-office/src/office/paseo-host.js");

  fresh.open?.("ada");
  expect(open).toHaveBeenCalledWith("ada");
});

test("without onOpen the scene has nothing to open a session with", async () => {
  await startPage({});
  const { host: fresh } = await import("../../vendor/my-office/src/office/paseo-host.js");

  expect(fresh.open).toBeNull();
});
