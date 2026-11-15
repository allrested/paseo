/**
 * @vitest-environment jsdom
 */
// The composer's Task prompt control, mounted. The control is the host's, so a plain button
// stands in for it; the composer and the RPC are the test's.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PluginComposerProvider, PluginRpcProvider } from "@getpaseo/plugin/client/host";
import type { PluginComposer } from "@getpaseo/plugin/client";
import { pickedTask } from "./picked-task.js";
import { TaskPrompt } from "./task-prompt.js";

let failures: string[];

vi.mock("@getpaseo/plugin/client/ui", () => ({
  // The host shows a rejected press as a toast; the stand-in keeps the message.
  Action: ({ title, onPress }: { title: string; onPress(event: object): void | Promise<void> }) =>
    createElement(
      "button",
      {
        type: "button",
        onClick: () =>
          void Promise.resolve(onPress({})).catch((error: Error) => failures.push(error.message)),
      },
      title,
    ),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let calls: Array<[method: string, input: unknown]>;
let answer: { text: string } | Error;
let composer: PluginComposer;
let did: string[];
let container: HTMLElement;
let root: Root;

async function invoke(method: string, input: unknown): Promise<unknown> {
  calls.push([method, input]);
  if (answer instanceof Error) throw answer;
  return answer;
}

const subscribe = () => {
  throw new Error("The control subscribes to nothing");
};

async function mount(context: PluginComposer["context"] = "new-workspace"): Promise<void> {
  composer = {
    context,
    prompt: "",
    insertText: (text: string) => void did.push(`insert:${text}`),
    focus: async () => void did.push("focus"),
  } as unknown as PluginComposer;
  await act(async () => {
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <PluginComposerProvider composer={composer}>
          <TaskPrompt />
        </PluginComposerProvider>
      </PluginRpcProvider>,
    );
  });
}

const button = () => container.querySelector("button");
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

beforeEach(() => {
  calls = [];
  did = [];
  failures = [];
  answer = { text: "Work on BWLT-12: Add the webhook" };
  pickedTask.set(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("the control is there once a task is picked, and gone when the pick is undone", async () => {
  await mount();
  expect(button()).toBeNull();
  await act(async () => pickedTask.set("jira:BWLT-12"));
  expect(button()?.textContent).toBe("Task prompt");
  await act(async () => pickedTask.set(null));
  expect(button()).toBeNull();
});

test("only the New workspace composer has it: a workspace's own composers know no pick", async () => {
  pickedTask.set("jira:BWLT-12");
  await mount("draft");
  expect(button()).toBeNull();
  await mount("agent");
  expect(button()).toBeNull();
});

test("a press puts the task's prompt at the cursor and leaves the sending to the user", async () => {
  pickedTask.set("jira:BWLT-12");
  await mount();
  await act(async () => button()?.click());
  await settle();
  expect(calls).toEqual([["tasks.prompt.fill", { id: "jira:BWLT-12" }]]);
  expect(did).toEqual(["insert:Work on BWLT-12: Add the webhook", "focus"]);
  expect(failures).toEqual([]);
});

test("a task that cannot be read puts nothing in, and fails with the tracker's own sentence", async () => {
  pickedTask.set("jira:BWLT-12");
  answer = new Error(
    "Request failed: Jira answered HTTP 500. requestType=plugin.rpc.invoke.request code=handler_error",
  );
  await mount();
  await act(async () => button()?.click());
  await settle();
  expect(did).toEqual([]);
  expect(failures).toEqual(["Jira answered HTTP 500."]);
});
