import { expect, test } from "vitest";
import type {
  ActivityStep,
  AgentStatus,
  OfficeAgent,
  OfficeSnapshot,
} from "../shared/contracts.js";
import {
  chipOf,
  feedCards,
  feedEvents,
  feedStore,
  recordOfficeState,
  type FeedEvent,
  type FeedKind,
} from "./activity-feed.js";
import { eventText } from "./activity-feed-text.js";
import { EMPTY_OFFICE } from "./office-state.js";

const t0 = Date.parse("2026-11-17T09:00:00.000Z");
const IDLE_SINCE = "2026-11-16T00:00:00.000Z";

type AgentSpec = AgentStatus | Partial<OfficeAgent>;

function agent(id: string, spec: AgentSpec): OfficeAgent {
  const base: OfficeAgent = {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
  };
  return typeof spec === "string" ? { ...base, status: spec } : { ...base, ...spec };
}

/** A state whose agents are given as id → status, or id → the agent's fields. */
function s(
  agents: Record<string, AgentSpec>,
  doing: Record<string, ActivityStep> = {},
): OfficeSnapshot {
  return {
    ...EMPTY_OFFICE,
    agents: Object.entries(agents).map(([id, spec]) => agent(id, spec)),
    doing,
  };
}

function ev(id: string, at: number, overrides: Partial<FeedEvent> = {}): FeedEvent {
  const agentId = id.split(":")[0] ?? "a";
  const kind: FeedKind = overrides.kind ?? "edit";
  return {
    id,
    agentId,
    title: agentId.toUpperCase(),
    at,
    kind,
    alert: false,
    text: eventText(kind),
    ...overrides,
  };
}

const ids = (events: readonly FeedEvent[]) => events.map((event) => event.id);

test("the first state makes no events", () => {
  expect(feedEvents(null, s({ ali: "running" }), t0)).toEqual([]);
});

test("a new step key is one event named for its kind", () => {
  const e = feedEvents(
    s({ ali: "running" }, { ali: { kind: "edit", key: "k1" } }),
    s({ ali: "running" }, { ali: { kind: "edit", key: "k2" } }),
    t0,
  );
  expect(e.map((x) => x.text)).toEqual(["Editing"]);
  expect(e[0]?.id).toBe("ali:k2");
  expect(e[0]?.agentId).toBe("ali");
  expect(e[0]?.at).toBe(t0);
  expect(e[0]?.alert).toBe(false);
  expect(e[0]?.kind).toBe("edit");
});

test("the same step read again makes no event", () => {
  const before = s({ ali: "running" }, { ali: { kind: "read", key: "k1" } });
  expect(
    feedEvents(before, s({ ali: "running" }, { ali: { kind: "read", key: "k1" } }), t0),
  ).toEqual([]);
});

test("a failed test run says so", () => {
  const e = feedEvents(
    s({ ali: "running" }, { ali: { kind: "test", key: "k1" } }),
    s({ ali: "running" }, { ali: { kind: "test", key: "k1", result: "failed" } }),
    t0,
  );
  expect(e.map((x) => x.text)).toEqual(["Running tests failed"]);
  expect(e[0]?.id).toBe("ali:k1");

  const deploy = feedEvents(
    s({ ali: "running" }, { ali: { kind: "deploy", key: "d1" } }),
    s({ ali: "running" }, { ali: { kind: "deploy", key: "d1", result: "failed" } }),
    t0,
  );
  expect(deploy.map((x) => x.text)).toEqual(["Deploying failed"]);
});

test("status changes: started, finished, error", () => {
  const events = feedEvents(
    s({ ali: "idle", bob: "running", cid: "running" }),
    s({ ali: "running", bob: { status: "idle", idleSince: IDLE_SINCE }, cid: "error" }),
    t0,
  );
  expect(events.map((event) => [event.agentId, event.kind, event.text])).toEqual([
    ["ali", "started", "Started working"],
    ["bob", "finished", "Finished"],
    ["cid", "error", "Stopped on an error"],
  ]);
  expect(events.map((event) => event.alert)).toEqual([false, false, true]);
  expect(events.map((event) => event.at)).toEqual([t0, t0, t0]);
  // A status event's id is the status and the moment it changed: the idle moment when the state
  // says it, else the time of this read.
  expect(ids(events)).toEqual([`ali:running@${t0}`, `bob:idle@${IDLE_SINCE}`, `cid:error@${t0}`]);
});

test("a new permission is an alert with its title", () => {
  const events = feedEvents(
    s({
      ali: {
        status: "running",
        permissions: [{ id: "p1", kind: "tool", title: "Bash" }],
      },
    }),
    s({
      ali: {
        status: "running",
        permissions: [
          { id: "p1", kind: "tool", title: "Bash" },
          { id: "p2", kind: "plan", title: "Write the plan" },
        ],
      },
    }),
    t0,
  );
  expect(events.map((event) => [event.id, event.kind, event.alert, event.text])).toEqual([
    ["ali:p2", "permission", true, "Needs permission: Write the plan"],
  ]);
});

test("a new sub-agent is an event of its parent's kind Agents", () => {
  const events = feedEvents(
    s({ boss: "running" }),
    s({
      boss: "running",
      scout: { status: "running", parentAgentId: "boss", title: "Scout", name: "boss-1" },
    }),
    t0,
  );
  expect(events.map((event) => [event.kind, event.agentId, event.text])).toEqual([
    ["subagent-started", "boss", "Started boss-1"],
  ]);
  expect(chipOf(events[0]?.kind ?? "started")).toBe("agent");
  expect(events[0]?.alert).toBe(false);
});

test("an agent that appeared on its own is no event of its own", () => {
  // It is told by its status change, once it has one; nothing floods the feed while it starts.
  expect(feedEvents(s({ boss: "running" }), s({ boss: "running", helper: "running" }), t0)).toEqual(
    [],
  );
});

test("an agent that left makes no event", () => {
  expect(
    feedEvents(s({ ali: "running" }), s({}, { ali: { kind: "edit", key: "k1" } }), t0),
  ).toEqual([]);
});

test("the store keeps one of each event and the newest 300", () => {
  feedStore.reset();
  const events = [ev("a:k1", t0 - 1000), ev("a:k2", t0)];
  feedStore.push(events);
  feedStore.push(events);
  expect(ids(feedStore.getSnapshot())).toEqual(["a:k1", "a:k2"]);

  const many = Array.from({ length: 400 }, (_, index) => ev(`a:k${index}`, t0 + index));
  feedStore.push(many);
  const kept = feedStore.getSnapshot();
  expect(kept).toHaveLength(300);
  expect(kept[0]?.id).toBe("a:k100");
  expect(kept.at(-1)?.id).toBe("a:k399");
});

test("the store says a step ended: the newest telling of one id is kept", () => {
  feedStore.reset();
  feedStore.push([ev("a:k1", t0, { kind: "test", text: eventText("test") })]);
  feedStore.push([
    ev("a:k1", t0 + 20_000, { kind: "test", text: eventText("test", { failed: true }) }),
  ]);
  const kept = feedStore.getSnapshot();
  expect(kept).toHaveLength(1);
  expect(kept[0]?.text).toBe("Running tests failed");
});

test("the store tells its subscribers, and only when it changed", () => {
  feedStore.reset();
  let told = 0;
  const stop = feedStore.subscribe(() => {
    told += 1;
  });
  feedStore.push([ev("a:k1", t0)]);
  expect(told).toBe(1);
  feedStore.push([ev("a:k1", t0)]);
  expect(told).toBe(1);
  feedStore.push([ev("a:k2", t0)]);
  expect(told).toBe(2);
  stop();
  feedStore.push([ev("a:k3", t0)]);
  expect(told).toBe(2);
});

test("two subscriptions recording the same pair push it once", () => {
  feedStore.reset();
  const first = s({ ali: "idle" });
  const next = s({ ali: "running" });
  recordOfficeState(null, first, t0);
  expect(feedStore.getSnapshot()).toEqual([]);
  recordOfficeState(first, next, t0);
  expect(ids(feedStore.getSnapshot())).toEqual([`ali:running@${t0}`]);
  // The other subscription's own view of the same change, and an equal state in a new object.
  recordOfficeState(first, next, t0);
  recordOfficeState(first, { ...next }, t0);
  expect(feedStore.getSnapshot()).toHaveLength(1);
});

test("each subscription diffs the pair it came from, so a late first state says nothing", () => {
  feedStore.reset();
  const idle = s({ ali: "idle" });
  const running = s({ ali: "running" });
  // The surface's own stream: its first state, then the change.
  recordOfficeState(null, idle, t0);
  recordOfficeState(idle, running, t0);
  // A panel mounts late. Its snapshot is the idle state, read before the surface's change landed,
  // and then it sees the same change. Neither call may diff the idle state as if the panel had
  // come from the running one: that reversed pair says the agent finished.
  recordOfficeState(null, idle, t0 + 1000);
  recordOfficeState(idle, running, t0);
  expect(feedStore.getSnapshot().map((event) => [event.id, event.text])).toEqual([
    [`ali:running@${t0}`, "Started working"],
  ]);
});

test("a failure one subscription saw is not undone by one that had not seen it", () => {
  feedStore.reset();
  const step = s({ ali: "running" }, { ali: { kind: "test", key: "t1" } });
  const failed = s({ ali: "running" }, { ali: { kind: "test", key: "t1", result: "failed" } });
  // The surface sees the step, then its end.
  recordOfficeState(null, step, t0);
  recordOfficeState(step, failed, t0 + 5000);
  // The panel's own snapshot was the step before the end, then this same end. Its pair is the one
  // the surface used, so the dedup keeps the single failed line where it happened.
  recordOfficeState(null, step, t0 + 6000);
  recordOfficeState(step, failed, t0 + 5000);
  expect(feedStore.getSnapshot().map((event) => [event.id, event.text, event.at])).toEqual([
    ["ali:t1", "Running tests failed", t0 + 5000],
  ]);
});

test("one subscription's change is not diffed against another's state", () => {
  feedStore.reset();
  const idle = s({ ali: "idle" });
  const running = s({ ali: "running" });
  let told = 0;
  feedStore.subscribe(() => {
    told += 1;
  });
  // The surface came from idle and is now running.
  recordOfficeState(idle, running, t0);
  // A panel that came from its own first state, which is created while the agent already runs,
  // and then the same running state: nothing changed for it.
  recordOfficeState(null, running, t0 + 1000);
  recordOfficeState(running, { ...running }, t0 + 2000);
  // A global last state would diff the panel's own state against the surface's and see the same
  // change twice: two tells, two lines. The pair each caller brings says nothing changed.
  expect(told).toBe(1);
  expect(feedStore.getSnapshot()).toHaveLength(1);
});

test("two subscriptions a millisecond apart make one Started working", () => {
  feedStore.reset();
  const idle = s({ ali: "idle" });
  const running = s({ ali: "running" });
  recordOfficeState(idle, running, t0);
  let told = 0;
  feedStore.subscribe(() => {
    told += 1;
  });
  recordOfficeState(idle, running, t0 + 1);
  expect(feedStore.getSnapshot().map((event) => [event.text, event.at])).toEqual([
    ["Started working", t0],
  ]);
  expect(told).toBe(0);
});

test("two subscriptions a millisecond apart make one Stopped on an error", () => {
  feedStore.reset();
  const running = s({ ali: "running" });
  const stopped = s({ ali: "error" });
  recordOfficeState(running, stopped, t0);
  recordOfficeState(running, stopped, t0 + 1);
  expect(feedStore.getSnapshot().map((event) => [event.text, event.at])).toEqual([
    ["Stopped on an error", t0],
  ]);
});

test("two starts three seconds apart stay two events", () => {
  feedStore.reset();
  recordOfficeState(s({ ali: "idle" }), s({ ali: "running" }), t0);
  recordOfficeState(s({ ali: "idle" }), s({ ali: "running" }), t0 + 3000);
  expect(feedStore.getSnapshot().map((event) => [event.text, event.at])).toEqual([
    ["Started working", t0],
    ["Started working", t0 + 3000],
  ]);
});

test("an event keeps the agent's title after the agent leaves", () => {
  feedStore.reset();
  const alive = s({ ali: { status: "running", title: "Ali One" } });
  const working = s(
    { ali: { status: "running", title: "Ali One" } },
    { ali: { kind: "edit", key: "k1" } },
  );
  const gone = s({}, { ali: { kind: "edit", key: "k1" } });
  recordOfficeState(null, alive, t0);
  recordOfficeState(alive, working, t0);
  recordOfficeState(working, gone, t0);
  expect(feedStore.getSnapshot().map((event) => [event.title, event.text])).toEqual([
    ["Ali One", "Editing"],
  ]);
});

test("cards group one agent within four minutes and show four lines and +N more", () => {
  const kinds: FeedKind[] = ["edit", "read", "command", "test", "push", "commit"];
  const events = kinds.map((kind, n) => ev(`a:k${n}`, t0 - n * 30_000, { kind }));
  const [card, ...rest] = feedCards(events, "all", new Set());
  expect(rest).toEqual([]);
  expect(card).toEqual({
    agentId: "a",
    title: "A",
    at: t0,
    lines: ["Editing", "Reading", "Running a command", "Running tests"],
    more: 2,
    alert: false,
  });

  // Six minutes after the card's first event is another card.
  const split = feedCards([...events, ev("a:k9", t0 - 6 * 60_000)], "all", new Set());
  expect(split).toHaveLength(2);
  expect(split[1]).toMatchObject({ agentId: "a", at: t0 - 6 * 60_000, more: 0 });
});

test("cards group one agent's consecutive events, not an agent's events apart", () => {
  const cards = feedCards(
    [ev("a:k1", t0), ev("b:k1", t0 - 1000), ev("a:k2", t0 - 2000)],
    "all",
    new Set(),
  );
  expect(cards.map((card) => card.agentId)).toEqual(["a", "b", "a"]);
});

test("alerts stand alone", () => {
  const cards = feedCards(
    [
      ev("a:k1", t0),
      ev("a:p1", t0 - 1000, {
        kind: "permission",
        alert: true,
        text: eventText("permission", { title: "Bash" }),
      }),
      ev("a:k2", t0 - 2000),
    ],
    "all",
    new Set(),
  );
  expect(cards.map((card) => [card.agentId, card.lines, card.more, card.alert])).toEqual([
    ["a", ["Editing"], 0, false],
    ["a", ["Needs permission: Bash"], 0, true],
    ["a", ["Editing"], 0, false],
  ]);
});

test("the Needs you tab and the chips filter", () => {
  const events = [
    ev("a:k1", t0 - 5 * 60_000, { kind: "command" }),
    ev("b:k1", t0 - 4 * 60_000, { kind: "edit" }),
    ev("c:p1", t0 - 3 * 60_000, {
      kind: "permission",
      alert: true,
      text: eventText("permission", { title: "Bash" }),
    }),
    ev("d:k1", t0 - 2 * 60_000, { kind: "error", alert: true }),
    ev("e:k1", t0 - 60_000, {
      kind: "subagent-started",
      text: eventText("subagent-started", { title: "Scout" }),
    }),
    ev("f:k1", t0, { kind: "started" }),
  ];
  expect(feedCards(events, "all", new Set()).map((card) => card.agentId)).toEqual([
    "f",
    "e",
    "d",
    "c",
    "b",
    "a",
  ]);
  expect(feedCards(events, "attention", new Set()).map((card) => card.agentId)).toEqual(["d", "c"]);
  expect(feedCards(events, "all", new Set(["cmd"])).map((card) => card.agentId)).toEqual(["a"]);
  expect(feedCards(events, "all", new Set(["edit"])).map((card) => card.agentId)).toEqual(["b"]);
  expect(feedCards(events, "all", new Set(["cmd", "agent"])).map((card) => card.agentId)).toEqual([
    "e",
    "a",
  ]);
  expect(chipOf("started")).toBeNull();
  expect(chipOf("permission")).toBeNull();
  expect(chipOf("subagent-started")).toBe("agent");
});

test("no event text names a file, a command or a prompt", () => {
  const events = feedEvents(
    s({ ali: "running" }),
    s(
      {
        ali: {
          status: "running",
          permissions: [
            { id: "p1", kind: "tool", title: "Bash", detail: "rm -rf ./build && cat .env" },
          ],
        },
      },
      { ali: { kind: "command", key: "k1" } },
    ),
    t0,
  );
  const texts = events.map((event) => event.text);
  expect(texts).toContain("Needs permission: Bash");
  expect(texts).toContain("Running a command");
  for (const text of texts) {
    expect(text).not.toContain("rm -rf");
    expect(text).not.toContain(".env");
    expect(text).not.toContain("./build");
  }
});
