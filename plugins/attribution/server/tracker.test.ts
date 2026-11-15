// The rule: when a folder is snapshotted, and whose a change is.
import { expect, test } from "vitest";
import type { RecordInput } from "./record.js";
import type { Shadow } from "./shadow.js";
import { createTracker, type TurnAgent } from "./tracker.js";
import type { WorkTree } from "./work-tree.js";

const agent = (overrides: Partial<TurnAgent> = {}): TurnAgent => ({
  id: "a1",
  parentAgentId: null,
  background: false,
  cwd: "/work/shop",
  title: "Checkout total",
  provider: "claude",
  workspaceId: "w1",
  ...overrides,
});

function setup() {
  /** The tree each folder's next snapshot answers with; a test changes it to edit the folder. */
  const trees = new Map<string, string>();
  const records: Array<{ top: string; before: string; after: string; authors: string[] }> = [];
  const changed: string[][] = [];
  const logs: string[] = [];
  const snapshots: string[] = [];
  let failing: string | null = null;
  const tracker = createTracker({
    // "/work/shop/src" is inside the checkout at "/work/shop"; "/tmp" is in none.
    async findWorkTree(folder): Promise<WorkTree | null> {
      if (!folder.startsWith("/work/")) return null;
      const top = folder.split("/").slice(0, 3).join("/");
      return { top, objects: `${top}/.git/objects`, index: `${top}/.git/index` };
    },
    async openShadow(top): Promise<Shadow> {
      return { gitDir: `${top}!git`, objects: `${top}!objects`, snapIndex: "", scratch: "" };
    },
    async snapshot(workTree) {
      snapshots.push(workTree.top);
      if (failing === workTree.top) throw new Error("index locked");
      return trees.get(workTree.top) ?? "t0";
    },
    async record(input: RecordInput) {
      records.push({
        top: input.workTree.top,
        before: input.before,
        after: input.after,
        authors: input.authors.map((author) => `${author.id}:${author.title}`),
      });
      return 1;
    },
    now: () => 0,
    log: (message) => logs.push(message),
    changed: (workspaceIds) => changed.push(workspaceIds),
  });
  return {
    tracker,
    records,
    changed,
    logs,
    snapshots,
    edit: (top: string, tree: string) => trees.set(top, tree),
    fail: (top: string | null) => (failing = top),
  };
}

test("what changes during a turn is recorded for its agent", async () => {
  const { tracker, records, changed, edit } = setup();

  await tracker.started(agent());
  edit("/work/shop", "t1");
  await tracker.ended("a1");

  expect(records).toEqual([
    { top: "/work/shop", before: "t0", after: "t1", authors: ["a1:Checkout total"] },
  ]);
  expect(changed).toEqual([["w1"]]);
});

test("what changes between turns is recorded for nobody", async () => {
  const { tracker, records, edit } = setup();
  await tracker.started(agent());
  await tracker.ended("a1");

  edit("/work/shop", "by-hand");
  await tracker.started(agent());
  await tracker.ended("a1");

  expect(records).toEqual([]);
});

test("a change made while two agents run is recorded for both, then each for its own", async () => {
  const { tracker, records, edit } = setup();
  await tracker.started(agent());
  edit("/work/shop", "t1");
  await tracker.started(agent({ id: "a2", title: "Tax rules", cwd: "/work/shop/src" }));
  edit("/work/shop", "t2");
  await tracker.ended("a1");
  edit("/work/shop", "t3");
  await tracker.ended("a2");

  expect(records.map((each) => [each.before, each.after, each.authors])).toEqual([
    ["t0", "t1", ["a1:Checkout total"]],
    ["t1", "t2", ["a1:Checkout total", "a2:Tax rules"]],
    ["t2", "t3", ["a2:Tax rules"]],
  ]);
});

test("a helper's edits count for its parent, also after the helper's own turn ended", async () => {
  const { tracker, records, edit } = setup();
  await tracker.started(agent());
  await tracker.started(
    agent({ id: "helper", parentAgentId: "a1", background: true, title: "Sub" }),
  );
  edit("/work/shop", "t1");
  await tracker.ended("helper");
  edit("/work/shop", "t2");
  await tracker.ended("a1");

  expect(records.map((each) => each.authors)).toEqual([
    ["a1:Checkout total"],
    ["a1:Checkout total"],
  ]);
});

test("a helper whose parent has no turn here still credits the parent", async () => {
  const { tracker, records, edit } = setup();
  await tracker.started(
    agent({ id: "helper", parentAgentId: "a1", background: true, title: "Sub" }),
  );
  edit("/work/shop", "t1");
  await tracker.ended("helper");

  expect(records.map((each) => each.authors)).toEqual([["a1:null"]]);
});

test("folders are told apart, and a folder outside a checkout is left alone", async () => {
  const { tracker, records, snapshots, edit } = setup();
  await tracker.started(agent());
  await tracker.started(agent({ id: "a2", cwd: "/work/api", workspaceId: "w2" }));
  await tracker.started(agent({ id: "a3", cwd: "/tmp/scratch" }));
  edit("/work/api", "t1");
  await tracker.ended("a2");
  await tracker.ended("a3");
  await tracker.ended("a1");

  expect(records.map((each) => [each.top, each.authors])).toEqual([
    ["/work/api", ["a2:Checkout total"]],
  ]);
  expect(snapshots).toEqual(["/work/shop", "/work/api", "/work/api", "/work/shop"]);
});

test("an end without a start is ignored, and an agent that is gone ends its turn", async () => {
  const { tracker, records, snapshots, edit } = setup();
  await tracker.ended("unknown");
  expect(snapshots).toEqual([]);

  await tracker.started(agent());
  edit("/work/shop", "t1");
  await tracker.gone("a1");
  edit("/work/shop", "t2");
  await tracker.started(agent({ id: "a2" }));
  await tracker.ended("a2");

  // The change before the agent went is its own; the one after is nobody's.
  expect(records.map((each) => [each.before, each.after])).toEqual([["t0", "t1"]]);
});

test("a second start of one agent in another folder ends its turn in the first", async () => {
  const { tracker, records, edit } = setup();
  await tracker.started(agent());
  edit("/work/shop", "t1");
  await tracker.started(agent({ cwd: "/work/api" }));
  edit("/work/shop", "t2");
  await tracker.started(agent({ id: "a2" }));
  await tracker.ended("a2");

  expect(records.map((each) => [each.top, each.before, each.after])).toEqual([
    ["/work/shop", "t0", "t1"],
  ]);
});

test("a snapshot that fails is logged, and the change around it is not recorded", async () => {
  const { tracker, records, logs, edit, fail } = setup();
  await tracker.started(agent());
  edit("/work/shop", "t1");
  fail("/work/shop");
  await tracker.started(agent({ id: "a2" }));
  fail(null);
  edit("/work/shop", "t2");
  await tracker.ended("a1");
  edit("/work/shop", "t3");
  await tracker.ended("a2");

  expect(logs).toEqual(["[attribution] no snapshot of /work/shop: index locked"]);
  // After the failed snapshot there is nothing to compare with until the next one.
  expect(records.map((each) => [each.before, each.after])).toEqual([["t2", "t3"]]);
});

test("hooks that fire at once are handled in their order", async () => {
  const { tracker, records, edit } = setup();
  edit("/work/shop", "t1");

  // The end is asked for before the start's folder is found.
  await Promise.all([tracker.started(agent()), tracker.ended("a1")]);
  edit("/work/shop", "t2");
  await tracker.started(agent({ id: "a2" }));
  await tracker.ended("a2");

  expect(records).toEqual([]);
});
