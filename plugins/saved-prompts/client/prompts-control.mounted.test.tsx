/**
 * @vitest-environment jsdom
 */
// The composer's Prompts list, mounted with the host's parts replaced by plain stand-ins: a list
// that searches when it opens and as the user types, the settings calls, and a composer.
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PluginComposerProvider, PluginRpcProvider } from "@getpaseo/plugin/client/host";
import type { PluginComposer } from "@getpaseo/plugin/client";
import type { ComboboxItem, ComboboxProps } from "@getpaseo/plugin/client/ui";
import { PromptsControl } from "./prompts-control.js";

const toasts: string[] = [];

vi.mock("@getpaseo/plugin/client/ui", () => {
  const toast = { show: (message: string) => void toasts.push(message), error() {} };
  function Combobox({ title, search: find, onSelect }: ComboboxProps<ComboboxItem>) {
    const [items, setItems] = useState<readonly ComboboxItem[]>([]);
    const [failure, setFailure] = useState<string | null>(null);
    const fail = (error: unknown) => setFailure(error instanceof Error ? error.message : "?");
    const run = (query: string) => void find({ query }).then(setItems, fail);
    return createElement(
      "section",
      { "aria-label": title },
      createElement("button", { type: "button", onClick: () => run("") }, "Open"),
      createElement("input", {
        "aria-label": "Search",
        onChange: (event: { target: { value: string } }) => run(event.target.value),
      }),
      failure === null ? null : createElement("p", { role: "alert" }, failure),
      items.map((item) =>
        createElement(
          "button",
          {
            key: item.id,
            type: "button",
            title: item.description,
            onClick: () => void Promise.resolve(onSelect({ item })).catch(fail),
          },
          item.label,
        ),
      ),
    );
  }
  return { Combobox, useToast: () => toast };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const REVIEW = { name: "review", text: "Review the diff and list the risks first." };

let stored:
  | { status: "ready"; revision: string; values: unknown }
  | { status: "invalid"; revision: string; error: string };
let calls: Array<{ method: string; input: unknown }>;
let composer: PluginComposer;
let container: HTMLElement;
let root: Root;

async function invoke(method: string, input: unknown): Promise<unknown> {
  calls.push({ method, input });
  if (method === "settings.prompts.read") return stored;
  if (method === "settings.prompts.write") {
    const { values } = input as { values: unknown };
    stored = { status: "ready", revision: "r2", values };
    return { status: "saved", revision: "r2", values };
  }
  throw new Error(`Unexpected call ${method}`);
}

const subscribe = () => ({ close() {} });

function composerWith(prompt: string): PluginComposer {
  return {
    context: "agent",
    prompt,
    insertText: vi.fn(),
    setPrompt: vi.fn(),
    focus: vi.fn(async () => {}),
  } as unknown as PluginComposer;
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(prompt = ""): Promise<void> {
  composer = composerWith(prompt);
  await act(async () => {
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe as never}>
        <PluginComposerProvider composer={composer}>
          <PromptsControl />
        </PluginComposerProvider>
      </PluginRpcProvider>,
    );
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((each) => each.textContent === text);
  if (!found) throw new Error(`No button "${text}" among: ${rows().join(" | ")}`);
  return found;
}

async function press(text: string): Promise<void> {
  await act(async () => button(text).click());
  await settle();
}

async function search(query: string): Promise<void> {
  const field = container.querySelector("input");
  if (!field) throw new Error("No search field");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

const rows = () =>
  [...container.querySelectorAll("button")]
    .map((each) => each.textContent ?? "")
    .filter((text) => text !== "Open");

const writes = () => calls.filter((call) => call.method === "settings.prompts.write");

beforeEach(() => {
  stored = { status: "ready", revision: "r1", values: { prompts: [REVIEW] } };
  calls = [];
  toasts.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("is the composer's Prompts control", async () => {
  await mount();
  expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Prompts");
});

test("opening reads the saved list; a pick goes in at the cursor and the cursor stays there", async () => {
  await mount("Before. ");
  await press("Open");
  expect(rows()).toEqual(["review"]);
  expect(button("review").title).toBe("Review the diff and list the risks first.");

  await press("review");
  expect(composer.insertText).toHaveBeenCalledExactlyOnceWith(REVIEW.text);
  expect(composer.focus).toHaveBeenCalledExactlyOnceWith();
  expect(composer.setPrompt).not.toHaveBeenCalled();
  expect(writes()).toEqual([]);
});

test("each opening reads again, so a prompt saved elsewhere is there", async () => {
  await mount();
  await press("Open");
  stored = {
    status: "ready",
    revision: "r5",
    values: { prompts: [REVIEW, { name: "tests", text: "Write the tests." }] },
  };
  await press("Open");
  expect(rows()).toEqual(["review", "tests"]);
});

test("a new name keeps the composer's text and says so, without touching the composer", async () => {
  const text = "Plan the tests before writing them.\n";
  await mount(text);
  await search("plan");
  expect(rows()).toEqual(['Save as "plan"']);

  await press('Save as "plan"');
  expect(writes()).toEqual([
    {
      method: "settings.prompts.write",
      input: { revision: "r1", values: { prompts: [REVIEW, { name: "plan", text }] } },
    },
  ]);
  expect(toasts).toEqual(['Saved as "plan"']);
  expect(composer.insertText).not.toHaveBeenCalled();
  expect(composer.focus).not.toHaveBeenCalled();
});

test("the empty list's row puts the cursor in the composer", async () => {
  stored = { status: "ready", revision: "r1", values: {} };
  await mount();
  await press("Open");
  expect(rows()).toEqual(["No saved prompts yet"]);

  await press("No saved prompts yet");
  expect(composer.focus).toHaveBeenCalledExactlyOnceWith();
  expect(composer.insertText).not.toHaveBeenCalled();
});

test("a list that cannot be read says why in place of the rows", async () => {
  stored = { status: "invalid", revision: "r1", error: "the file is not JSON" };
  await mount();
  await press("Open");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "The saved prompts cannot be read: the file is not JSON",
  );
  expect(rows()).toEqual([]);
});
