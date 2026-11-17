// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { bridgePageScript } from "./world-bridge-page.js";

interface Frame {
  post(text: string): void;
  onMessage: ((text: string) => void) | null;
}
let posted: unknown[];
let frame: Frame;

beforeEach(() => {
  posted = [];
  frame = { post: (text) => posted.push(JSON.parse(text)), onMessage: null };
  Reflect.set(window, "paseoFrame", frame);
  Reflect.deleteProperty(window, "PaseoOfficeWorld");
});

/** What the plugin sends: one string per call. */
function send(call: string, ...args: unknown[]): void {
  frame.onMessage?.(JSON.stringify({ call, args }));
}

const SCENE = `
  window.sceneLog = [];
  window.PaseoOfficeWorld = {
    version: 1,
    start(options) { window.sceneLog.push(["start", options]); },
    setSessions(list) { window.sceneLog.push(["setSessions", list]); },
    select(id) { window.sceneLog.push(["select", id]); },
    stop() { window.sceneLog.push(["stop"]); },
  };`;

function run(scene: string): void {
  new Function(bridgePageScript(scene))();
}
const log = () => Reflect.get(window, "sceneLog") as unknown[][];

test("each message calls PaseoOfficeWorld, in order", () => {
  run(SCENE);
  send("setSessions", [{ id: "a1" }]);
  send("select", "a1");
  expect(log()).toEqual([
    ["setSessions", [{ id: "a1" }]],
    ["select", "a1"],
  ]);
});

test("start gets stand-ins for the callbacks it was told of, and no others", () => {
  run(SCENE);
  send("start", { plan: "pro", callbacks: ["onSelect", "onProblem"] });
  const [, options] = log()[0] as [string, Record<string, unknown>];
  expect(Object.keys(options).sort()).toEqual(["onProblem", "onSelect", "plan"]);
  (options.onSelect as (id: string) => void)("a1");
  (options.onProblem as (text: string) => void)("lost");
  expect(posted).toEqual([
    { callback: "onSelect", args: ["a1"] },
    { callback: "onProblem", args: ["lost"] },
  ]);
});

test("a scene script that throws is a problem", () => {
  run('throw new Error("scene broke");');
  expect(posted).toEqual([{ problem: "scene broke" }]);
});

test("no PaseoOfficeWorld, or one of another version, is a problem", () => {
  run("window.other = 1;");
  expect(posted).toEqual([{ problem: "Unexpected office build" }]);
  posted.length = 0;
  Reflect.deleteProperty(window, "PaseoOfficeWorld");
  run("window.PaseoOfficeWorld = { version: 2 };");
  expect(posted).toEqual([{ problem: "Unexpected office build" }]);
});

test("a call the scene refuses, such as start with no WebGL, is a problem with its message", () => {
  run(
    `window.PaseoOfficeWorld = { version: 1, start() { throw new Error("WebGL2 is not available"); } };`,
  );
  send("start", { callbacks: [] });
  expect(posted).toEqual([{ problem: "WebGL2 is not available" }]);
});

test("a message that is not a call, or names no method, does nothing", () => {
  run(SCENE);
  frame.onMessage?.("not json");
  send("nothingByThisName");
  expect(log()).toEqual([]);
  expect(posted).toEqual([]);
});

test("Full screen is off in the page whatever the WebView says", () => {
  run(SCENE);
  expect(document.fullscreenEnabled).toBe(false);
});
