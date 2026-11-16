/**
 * @vitest-environment jsdom
 */
// The Stand-up notes card, mounted. The sheet, its scroller and the Markdown renderer are the
// host's, so plain stand-ins show what the card passed them; the notes come from a fake read.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NotesState } from "../shared/contracts.js";
import { NotesCard, type NotesMonth } from "./notes-card.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Markdown = ({ children }: { children: string }) =>
    createElement("div", { "data-markdown": "" }, children);
  return { Markdown, Modal, ScrollView };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const NOW = Date.parse("2026-11-16T09:00:00Z");
const NOTES: NotesState = {
  folderSet: true,
  writing: false,
  writtenAt: null,
  failedAgentId: null,
  problem: null,
  scheduleError: null,
};
const NOVEMBER =
  "# Notes\n\n## Contents\n\n---\n\n## 15 November 2026\n\nA\n\n---\n\n## 16 November 2026\n\nB\n";

/** The months each read asked for; undefined for this month. */
let asked: (string | undefined)[];
let answer: (month: string | undefined) => NotesMonth;
let refusal: Error | null;
let opened: string[];

async function read(input: { month?: string }): Promise<NotesMonth> {
  asked.push(input.month);
  if (refusal) throw refusal;
  return answer(input.month);
}
const openAgent = (agentId: string) => void opened.push(agentId);
const ignore = () => undefined;

function Harness({ notes }: { notes: NotesState }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <NotesCard
      open
      notes={notes}
      now={NOW}
      timeZone="UTC"
      read={read}
      onOpenAgent={openAgent}
      styles={styles}
      onClose={ignore}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  asked = [];
  refusal = null;
  opened = [];
  answer = (month) => ({
    folderSet: true,
    month: month ?? "202611",
    text: NOVEMBER,
    previous: "202610",
    next: null,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
async function mount(notes: NotesState = NOTES): Promise<void> {
  await act(async () => root.render(<Harness notes={notes} />));
  await settle();
}
const card = () => container.querySelector('section[aria-label="Stand-up notes"]');
const markdown = () =>
  [...container.querySelectorAll("[data-markdown]")].map((block) => block.textContent);

function byLabel(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}
const isOff = (label: string) => byLabel(label).getAttribute("aria-disabled") === "true";
async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await settle();
}

test("this month's notes, split before the newest entry, with only the months that have a file", async () => {
  await mount();
  expect(asked).toEqual([undefined]);
  expect(card()?.textContent).toContain("November 2026");
  expect(markdown()).toEqual([
    "# Notes\n\n## Contents\n\n---\n\n## 15 November 2026\n\nA\n\n---\n\n",
    "## 16 November 2026\n\nB\n",
  ]);
  expect(isOff("Previous month")).toBe(false);
  expect(isOff("Next month")).toBe(true);

  await press("Previous month");
  expect(asked).toEqual([undefined, "202610"]);
  expect(card()?.textContent).toContain("October 2026");
});

test("a month without a file says so", async () => {
  answer = () => ({ folderSet: true, month: "202612", text: null, previous: "202611", next: null });
  await mount();
  expect(card()?.textContent).toContain("No notes for December 2026.");
  expect(markdown()).toEqual([]);
});

test("without a notes folder the card says where to set one", async () => {
  answer = () => ({ folderSet: false, month: "202611", text: null, previous: null, next: null });
  await mount({ ...NOTES, folderSet: false });
  expect(card()?.textContent).toContain(
    "Set a notes folder in the office's settings to see the stand-up notes.",
  );
});

test("a read that fails shows in place of the notes", async () => {
  refusal = new Error("EACCES: permission denied");
  await mount();
  expect(card()?.textContent).toContain(
    "Unable to read the stand-up notes: EACCES: permission denied",
  );
  expect(markdown()).toEqual([]);
});

test("a writer that ends while the card is open reloads the month shown", async () => {
  await mount();
  await mount({ ...NOTES, writtenAt: NOW });
  // This month is asked for as this month again, so a write past midnight on the 1st shows.
  expect(asked).toEqual([undefined, undefined]);

  await press("Previous month");
  await mount({ ...NOTES, writtenAt: NOW + 1000 });
  expect(asked).toEqual([undefined, undefined, "202610", "202610"]);
});

test("a writer that stopped is named, with a way to it", async () => {
  await mount({ ...NOTES, failedAgentId: "w1", problem: "Rate limited" });
  expect(card()?.textContent).toContain("The writer stopped: Rate limited");
  await press("Open the writer");
  expect(opened).toEqual(["w1"]);
});
