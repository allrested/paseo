/**
 * @vitest-environment jsdom
 */
// The task connections screen, mounted. The settings kit is the host's, so each part is a plain
// stand-in that shows what the screen passed it; the settings state and the RPCs are the test's.
import { act, createElement, useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ConnectionsScreen } from "./connections-screen.js";

interface RowProps {
  label: string;
  hint?: string;
  error?: string | null;
}

let state: Record<string, unknown>;
let saves: Array<{ values: unknown; revision: string }>;
let saveResult: boolean;
let calls: Array<{ name: string; input: unknown }>;
let tokens: { jira: { hasToken: boolean }; gitlab: { hasToken: boolean } };
let testResult: () => Promise<{ account: string }>;

async function rpc(name: string, input: unknown): Promise<unknown> {
  calls.push({ name, input });
  if (name === "tasks.tokens.write") {
    const { source, token } = input as { source: "jira" | "gitlab"; token: string };
    tokens = { ...tokens, [source]: { hasToken: token.trim() !== "" } };
    return tokens;
  }
  if (name === "tasks.connections.test") return testResult();
  return tokens;
}

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => state,
  useRpc: (contract: { name: string }) => {
    // One function per contract for the life of the component, as the host's hook gives.
    const call = useRef((input: unknown) => rpc(contract.name, input));
    return call.current;
  },
}));

vi.mock("@getpaseo/plugin/client/ui", () => {
  const settingsRow = ({ label, hint, error }: RowProps, control: ReactNode) =>
    createElement(
      "div",
      { "data-row": label },
      createElement("span", null, label),
      hint === undefined ? null : createElement("small", null, hint),
      error ? createElement("em", { role: "alert" }, error) : null,
      control,
    );
  function SettingsInput(
    props: RowProps & {
      initialValue?: string;
      placeholder?: string;
      disabled?: boolean;
      secureTextEntry?: boolean;
      onChangeText(text: string): void;
      ref?: Ref<{ replaceText(text: string): void }>;
    },
  ) {
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(props.ref, () => ({
      replaceText(text: string) {
        if (input.current) input.current.value = text;
      },
    }));
    return settingsRow(
      props,
      createElement("input", {
        ref: input,
        type: props.secureTextEntry ? "password" : "text",
        defaultValue: props.initialValue,
        placeholder: props.placeholder,
        disabled: props.disabled === true,
        onChange: (event: { target: { value: string } }) => props.onChangeText(event.target.value),
      }),
    );
  }
  return {
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
    SettingsInput,
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const PROPS = {
  theme: { colors: new Proxy({}, { get: () => "#808080" }) },
  layout: { compact: true, platform: "web" },
  host: { id: "host", label: "Host" },
} as unknown as PluginSurfaceProps;

const SAVED = {
  jiraSite: "https://team.atlassian.net",
  jiraEmail: "me@team.test",
  gitlabUrl: "",
};

let container: HTMLElement;
let root: Root;

function ready(values: object, extra: Record<string, unknown> = {}): void {
  state = {
    status: "ready",
    revision: "r1",
    values,
    saving: false,
    saveError: null,
    save: async (next: object, revision: string) => {
      saves.push({ values: next, revision });
      if (saveResult) ready(next);
      else ready(values, { saveError: "The address is too long" });
      return saveResult;
    },
    reset: vi.fn(async () => true),
    reload: vi.fn(async () => {}),
    ...extra,
  };
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(): Promise<void> {
  await act(async () => root.render(<ConnectionsScreen {...PROPS} />));
  await settle();
}

function section(title: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`section[aria-label="${title}"]`);
  if (!found) throw new Error(`No section "${title}"`);
  return found;
}

const labels = (title: string) =>
  [...section(title).querySelectorAll<HTMLElement>("[data-row]")].map((each) => each.dataset.row);

function row(title: string, label: string): HTMLElement {
  const found = section(title).querySelector<HTMLElement>(`[data-row="${label}"]`);
  if (!found) throw new Error(`No row "${label}" in ${title} among: ${labels(title).join(" | ")}`);
  return found;
}

const field = (title: string, label: string) =>
  row(title, label).querySelector("input") as HTMLInputElement;
const hint = (title: string, label: string) =>
  row(title, label).querySelector("small")?.textContent ?? null;
const alert = (title: string, label: string) =>
  row(title, label).querySelector("[role=alert]")?.textContent ?? null;

async function press(title: string, label: string): Promise<void> {
  await act(async () => (row(title, label).querySelector("button") as HTMLButtonElement).click());
  await settle();
  // The host's settings state re-renders the screen when a save lands; the stand-in is a plain
  // variable, so the test renders again to show what it now holds.
  await mount();
}

async function type(title: string, label: string, text: string): Promise<void> {
  const input = field(title, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const written = () => calls.filter((call) => call.name === "tasks.tokens.write");

beforeEach(() => {
  saves = [];
  saveResult = true;
  calls = [];
  tokens = { jira: { hasToken: false }, gitlab: { hasToken: false } };
  testResult = async () => ({ account: "Rina Putri" });
  ready(SAVED);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("shows each tracker's saved address and asks for its token", async () => {
  await mount();
  expect(labels("Jira")).toEqual([
    "Site",
    "Email",
    "API token",
    "Save the Jira connection",
    "Test what is saved",
  ]);
  expect(labels("GitLab")).toEqual([
    "Address",
    "Access token",
    "Save the GitLab connection",
    "Test what is saved",
  ]);
  expect(field("Jira", "Site").value).toBe("https://team.atlassian.net");
  expect(field("Jira", "Email").value).toBe("me@team.test");
  expect(field("GitLab", "Address").value).toBe("");
  expect(field("Jira", "API token").type).toBe("password");
  expect(field("Jira", "API token").placeholder).toBe("Paste the token");
  expect(hint("Jira", "API token")).toBe("Made at id.atlassian.com under Security, API tokens");
  expect(hint("GitLab", "Access token")).toBe("A personal access token with the read_api scope");
});

test("a saved token is never shown: its row says it is kept and offers to remove it", async () => {
  tokens = { jira: { hasToken: true }, gitlab: { hasToken: false } };
  await mount();
  expect(field("Jira", "API token").value).toBe("");
  expect(field("Jira", "API token").placeholder).toBe("Saved");
  expect(hint("Jira", "API token")).toBe("Saved on the host. Type a new one to replace it");
  expect(labels("Jira")).toContain("Remove the Jira token from the host");
  expect(labels("GitLab")).not.toContain("Remove the GitLab token from the host");
});

test("Save stores the address with the other tracker's kept, then the token, and empties the box", async () => {
  await mount();
  await type("GitLab", "Address", "https://git.team.test");
  await type("GitLab", "Access token", "glpat-abc");
  await press("GitLab", "Save the GitLab connection");
  expect(saves).toEqual([
    { values: { ...SAVED, gitlabUrl: "https://git.team.test" }, revision: "r1" },
  ]);
  expect(written()).toEqual([
    { name: "tasks.tokens.write", input: { source: "gitlab", token: "glpat-abc" } },
  ]);
  expect(field("GitLab", "Access token").value).toBe("");
  expect(hint("GitLab", "Save the GitLab connection")).toBe("Saved");
  expect(labels("GitLab")).toContain("Remove the GitLab token from the host");
});

test("Save with no token typed leaves the saved token alone", async () => {
  tokens = { jira: { hasToken: true }, gitlab: { hasToken: false } };
  await mount();
  await type("Jira", "Email", "rina@team.test");
  await press("Jira", "Save the Jira connection");
  expect(saves).toEqual([{ values: { ...SAVED, jiraEmail: "rina@team.test" }, revision: "r1" }]);
  expect(written()).toEqual([]);
  expect(hint("Jira", "Save the Jira connection")).toBe("Saved");
});

test("an address the host refuses shows why on its own section, and the token is not sent", async () => {
  saveResult = false;
  await mount();
  await type("Jira", "Site", "x".repeat(300));
  await type("Jira", "API token", "jira-token");
  await press("Jira", "Save the Jira connection");
  expect(alert("Jira", "Save the Jira connection")).toBe("The address is too long");
  expect(alert("GitLab", "Save the GitLab connection")).toBeNull();
  expect(hint("Jira", "Save the Jira connection")).toBeNull();
  expect(written()).toEqual([]);
});

test("Test names the account that signed in", async () => {
  await mount();
  await press("Jira", "Test what is saved");
  expect(calls.at(-1)).toEqual({ name: "tasks.connections.test", input: { source: "jira" } });
  expect(hint("Jira", "Test what is saved")).toBe("Signed in as Rina Putri");
  expect(alert("Jira", "Test what is saved")).toBeNull();
});

test("Test shows the tracker's refusal", async () => {
  testResult = async () => {
    throw new Error(
      "Request failed: GitLab rejected the saved sign-in details. requestType=plugin.rpc.invoke.request code=handler_error",
    );
  };
  await mount();
  await press("GitLab", "Test what is saved");
  expect(alert("GitLab", "Test what is saved")).toBe("GitLab rejected the saved sign-in details.");
  expect(hint("GitLab", "Test what is saved")).toBeNull();
});

test("Remove takes the token off the host", async () => {
  tokens = { jira: { hasToken: true }, gitlab: { hasToken: false } };
  await mount();
  await press("Jira", "Remove the Jira token from the host");
  expect(written()).toEqual([{ name: "tasks.tokens.write", input: { source: "jira", token: "" } }]);
  expect(labels("Jira")).not.toContain("Remove the Jira token from the host");
  expect(hint("Jira", "Save the Jira connection")).toBe("Token removed");
  expect(field("Jira", "API token").placeholder).toBe("Paste the token");
});

test("while the settings load there is no form", async () => {
  state = { status: "loading" };
  await mount();
  expect(container.textContent).toBe("Loading the task connections...");
  expect(calls).toEqual([]);
});

test("settings that cannot be read offer a reload and a reset that keeps the tokens", async () => {
  const reset = vi.fn(async () => true);
  state = {
    status: "invalid",
    error: "Unsupported version 9",
    revision: "r1",
    saving: false,
    saveError: null,
    reset,
    reload: vi.fn(async () => {}),
  };
  await mount();
  expect(container.querySelector("[role=alert]")?.textContent).toBe("Unsupported version 9");
  expect(labels("Task connections")).toEqual([
    "Read the connections again",
    "Start with no connections",
  ]);
  expect(hint("Task connections", "Start with no connections")).toBe(
    "Replaces the stored addresses, which cannot be read. Saved tokens stay",
  );
  await act(async () =>
    (
      row("Task connections", "Start with no connections").querySelector(
        "button",
      ) as HTMLButtonElement
    ).click(),
  );
  expect(reset).toHaveBeenCalledTimes(1);
});
