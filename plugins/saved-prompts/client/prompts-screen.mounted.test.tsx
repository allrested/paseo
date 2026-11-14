/**
 * @vitest-environment jsdom
 */
// The Saved prompts settings screen, mounted. The settings kit is the host's, so each part is a
// plain stand-in that shows what the screen passed it; the settings state is the test's.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { PromptsScreen } from "./prompts-screen.js";

interface RowProps {
  label: string;
  hint?: string;
  error?: string | null;
}

let state: Record<string, unknown>;
let saves: Array<{ values: unknown; revision: string }>;
let saveResult: boolean;

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => state,
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput: Input } = await import("react-native");
  const settingsRow = ({ label, hint, error }: RowProps, control: ReactNode) =>
    createElement(
      "div",
      { "data-row": label },
      createElement("span", null, label),
      hint === undefined ? null : createElement("small", null, hint),
      error ? createElement("em", { role: "alert" }, error) : null,
      control,
    );
  return {
    TextInput: Input,
    SettingsSection: (props: { title: string; info?: string; children: ReactNode }) =>
      createElement("section", { "aria-label": props.title, title: props.info }, props.children),
    SettingsCard: (props: { children: ReactNode }) => createElement("div", null, props.children),
    SettingsAction: (
      props: RowProps & { actionLabel: string; disabled?: boolean; onPress(): void },
    ) =>
      settingsRow(
        props,
        createElement(
          "button",
          { type: "button", disabled: props.disabled === true, onClick: props.onPress },
          props.actionLabel,
        ),
      ),
    SettingsInput: (
      props: RowProps & {
        initialValue?: string;
        disabled?: boolean;
        onChangeText(text: string): void;
      },
    ) =>
      settingsRow(
        props,
        createElement("input", {
          defaultValue: props.initialValue,
          disabled: props.disabled === true,
          onChange: (event: { target: { value: string } }) =>
            props.onChangeText(event.target.value),
        }),
      ),
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const PROPS = {
  theme: { colors: new Proxy({}, { get: () => "#808080" }) },
  layout: { compact: true, platform: "web" },
  host: { id: "host", label: "Host" },
} as unknown as PluginSurfaceProps;

const REVIEW = { name: "review", text: "Review the diff and list the risks first." };
const TESTS = { name: "tests", text: "Write the missing tests.\nThen run them." };

let container: HTMLElement;
let root: Root;

function ready(prompts: unknown[], extra: Record<string, unknown> = {}): void {
  state = {
    status: "ready",
    revision: "r1",
    values: { prompts },
    saving: false,
    saveError: null,
    save: async (values: unknown, revision: string) => {
      saves.push({ values, revision });
      if (saveResult) ready((values as { prompts: unknown[] }).prompts);
      return saveResult;
    },
    reset: vi.fn(async () => true),
    reload: vi.fn(async () => {}),
    ...extra,
  };
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(): Promise<void> {
  await act(async () => root.render(<PromptsScreen {...PROPS} />));
}

function row(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-row="${label}"]`);
  if (!found) throw new Error(`No row "${label}" among: ${labels().join(" | ")}`);
  return found;
}

const labels = () =>
  [...container.querySelectorAll<HTMLElement>("[data-row]")].map((each) => each.dataset.row);

const action = (label: string) => row(label).querySelector("button") as HTMLButtonElement;
const hint = (label: string) => row(label).querySelector("small")?.textContent ?? null;

async function press(label: string): Promise<void> {
  await act(async () => action(label).click());
  await settle();
  // The host's settings state re-renders the screen when a save lands; the stand-in is a plain
  // variable, so the test renders again to show what it now holds.
  await mount();
}

async function type(field: Element | null, proto: object, text: string): Promise<void> {
  if (!field) throw new Error("No field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const typeName = (text: string) =>
  type(row("Name").querySelector("input"), HTMLInputElement.prototype, text);
const typeText = (text: string) =>
  type(container.querySelector("textarea"), HTMLTextAreaElement.prototype, text);

beforeEach(() => {
  saves = [];
  saveResult = true;
  ready([REVIEW, TESTS]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

test("lists each prompt by name with its first line, and a way to add one", async () => {
  await mount();
  expect(labels()).toEqual(["review", "tests", "New prompt"]);
  expect(hint("review")).toBe("Review the diff and list the risks first.");
  expect(hint("tests")).toBe("Write the missing tests.");
  expect(action("review").textContent).toBe("Edit");
  expect(container.querySelector("section")?.title).toContain("type /prompt");
});

test("an empty list says so on the one row it has", async () => {
  ready([]);
  await mount();
  expect(labels()).toEqual(["New prompt"]);
  expect(hint("New prompt")).toBe(
    "Nothing saved yet. You can also name the composer's text from its Prompts list",
  );
});

test("a new prompt is saved at the end once it has a name and a text", async () => {
  await mount();
  await press("New prompt");
  expect(labels()).toEqual(["review", "tests", "Name", "Add this prompt", "Discard changes"]);
  expect(action("Add this prompt").disabled).toBe(true);
  expect(hint("Add this prompt")).toBe("Give the prompt a name");
  expect(action("review").disabled).toBe(true);

  await typeName("notes");
  expect(hint("Add this prompt")).toBe("A prompt needs some text");
  await typeText("Write release notes.\n");
  expect(action("Add this prompt").disabled).toBe(false);
  expect(hint("Add this prompt")).toBeNull();

  await press("Add this prompt");
  expect(saves).toEqual([
    {
      revision: "r1",
      values: { prompts: [REVIEW, TESTS, { name: "notes", text: "Write release notes.\n" }] },
    },
  ]);
  expect(labels()).toEqual(["review", "tests", "notes", "New prompt"]);
});

test("a taken name is refused where it is typed", async () => {
  await mount();
  await press("New prompt");
  await typeName("Review");
  await typeText("x");
  expect(hint("Add this prompt")).toBe('A prompt named "review" exists already');
  expect(action("Add this prompt").disabled).toBe(true);
});

test("a prompt opens in its place with its name and text, and saves there", async () => {
  await mount();
  await press("review");
  expect(labels()).toEqual([
    "Name",
    "Save changes",
    "Discard changes",
    "Delete this prompt",
    "tests",
    "New prompt",
  ]);
  expect(row("Name").querySelector("input")?.value).toBe("review");
  expect(container.querySelector("textarea")?.value).toBe(REVIEW.text);
  expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe("Prompt text");

  await typeName("review PR");
  await typeText("Review this PR.");
  await press("Save changes");
  expect(saves).toEqual([
    {
      revision: "r1",
      values: { prompts: [{ name: "review PR", text: "Review this PR." }, TESTS] },
    },
  ]);
  expect(labels()).toEqual(["review PR", "tests", "New prompt"]);
});

test("Discard closes the prompt and writes nothing", async () => {
  await mount();
  await press("tests");
  await typeText("Something else.");
  await press("Discard changes");
  expect(saves).toEqual([]);
  expect(labels()).toEqual(["review", "tests", "New prompt"]);
  expect(hint("tests")).toBe("Write the missing tests.");
});

test("Delete asks for a second press, then removes that prompt only", async () => {
  await mount();
  await press("tests");
  await press("Delete this prompt");
  expect(saves).toEqual([]);
  expect(action("Delete this prompt").textContent).toBe("Confirm delete");
  expect(hint("Delete this prompt")).toBe('Press again within 5 s to delete "tests"');

  await press("Delete this prompt");
  expect(saves).toEqual([{ revision: "r1", values: { prompts: [REVIEW] } }]);
  expect(labels()).toEqual(["review", "New prompt"]);
});

test("a Delete left alone for 5 s is called off", async () => {
  vi.useFakeTimers();
  await mount();
  await act(async () => action("tests").click());
  await act(async () => action("Delete this prompt").click());
  expect(action("Delete this prompt").textContent).toBe("Confirm delete");
  await act(async () => void vi.advanceTimersByTime(5_000));
  expect(action("Delete this prompt").textContent).toBe("Delete");
  expect(saves).toEqual([]);
});

test("a save the host refuses keeps the prompt open and shows the reason", async () => {
  saveResult = false;
  await mount();
  await press("review");
  await typeText("Changed.");
  await press("Save changes");
  expect(saves).toHaveLength(1);
  expect(labels()).toContain("Save changes");

  ready([REVIEW, TESTS], { saveError: "Settings changed since they were read" });
  await mount();
  expect(row("Save changes").querySelector('[role="alert"]')?.textContent).toBe(
    "Settings changed since they were read",
  );
  expect(container.querySelector("textarea")?.value).toBe("Changed.");
});

test("a prompt deleted on another device while open is not saved over a neighbour", async () => {
  await mount();
  await press("review");
  await typeText("Changed.");
  ready([TESTS]);
  await mount();
  expect(labels()).toEqual([
    "tests",
    "Name",
    "Save changes",
    "Discard changes",
    "Delete this prompt",
  ]);
  expect(hint("Save changes")).toBe(
    "This prompt was renamed or deleted on another device. Discard, then open it again",
  );
  expect(action("Save changes").disabled).toBe(true);
});

test("a full list cannot take another", async () => {
  ready(Array.from({ length: 100 }, (_, i) => ({ name: `p${i}`, text: "x" })));
  await mount();
  expect(action("New prompt").disabled).toBe(true);
  expect(hint("New prompt")).toBe("The list holds at most 100 prompts");
});

test("while the list loads, and when it cannot be read, the screen says so", async () => {
  state = { status: "loading" };
  await mount();
  expect(container.textContent).toBe("Loading the saved prompts...");

  const reload = vi.fn(async () => {});
  state = {
    status: "error",
    error: "The host did not answer",
    reload,
    saving: false,
    saveError: null,
  };
  await mount();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("The host did not answer");
  expect(labels()).toEqual(["Read the saved prompts again"]);
  await press("Read the saved prompts again");
  expect(reload).toHaveBeenCalledOnce();
});

test("a stored file that cannot be read can be replaced by an empty list, on a second press", async () => {
  const reset = vi.fn(async () => true);
  state = {
    status: "invalid",
    error: "prompts: expected an array",
    revision: "r1",
    reset,
    reload: vi.fn(async () => {}),
    saving: false,
    saveError: null,
  };
  await mount();
  expect(labels()).toEqual(["Read the saved prompts again", "Start an empty list"]);
  await press("Start an empty list");
  expect(reset).not.toHaveBeenCalled();
  expect(hint("Start an empty list")).toBe("Press again within 5 s to delete every saved prompt");
  await press("Start an empty list");
  expect(reset).toHaveBeenCalledOnce();
});
