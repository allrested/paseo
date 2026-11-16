// @vitest-environment jsdom
// Paseo's entry to the 3D office (paseo-entry.js), driven through the API the plugin calls. The
// upstream modules it imports draw on a canvas or WebGL as they load, which a test has not: each
// is stood in with the little the entry reads. An upstream rule a test is about is copied into
// its stand-in, with where it comes from.
import { beforeEach, expect, test, vi } from "vitest";
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  workers: new Map<string, Record<string, unknown>>(),
  applauded: [] as string[],
}));

vi.mock("../../vendor/my-office/src/office/paseo-modules.js", () => ({ MODULES: [] }));
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
vi.mock("../../vendor/my-office/src/office/ui/camera-bar.js", () => ({ setup() {} }));
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
vi.mock("../../vendor/my-office/src/office/ui/mac-drawer.js", () => ({ setMacSnap() {} }));
vi.mock("../../vendor/my-office/src/office/interact/place-chips.js", () => ({ PLACES: {} }));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({ PROPS: new Map() }));
vi.mock("../../vendor/my-office/src/office/interact/place-cards.js", () => ({ closePlace() {} }));
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

// The entry sets the API on the window as it loads.
await import("../../vendor/my-office/src/office/paseo-entry.js");

interface World {
  start(options?: object): void;
  setSessions(list: object[]): void;
  event(e: { sess: string; type: string }): void;
}
const world = (globalThis as unknown as { PaseoOfficeWorld: World }).PaseoOfficeWorld;
world.start();

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

/** Someone at a desk: a session the scene knows and the person drawn for it. */
function seat(id: string) {
  world.setSessions([session(id)]);
  h.workers.set(id, { id, push() {} });
}

beforeEach(() => {
  h.sessions.clear();
  h.workers.clear();
  h.applauded.length = 0;
  state.sim = 0;
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
