/**
 * @vitest-environment jsdom
 */
// The Library card, mounted. The sheet and its inputs are the host's, so plain stand-ins show
// what the card passed them.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SkillsResult } from "../shared/contracts.js";
import { LibraryCard } from "./library-card.js";
import { LIBRARY_HELP, type LibraryTeam } from "./library-text.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  // (board-sheet.tsx, which the card takes its chips from, draws an icon from Task 4 on)
  const Icon = () => null;
  return { Icon, Modal, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const SKILLS: SkillsResult = {
  host: [{ name: "deploy", description: "Ship a release", folders: [".claude"] }],
  workspaces: {},
  readAt: "2026-11-16T08:00:00.000Z",
};
/** More than the six that show before the host's skills fold. */
const SEVEN: SkillsResult = {
  ...SKILLS,
  host: Array.from({ length: 7 }, (_, index) => ({
    name: `skill-${index + 1}`,
    description: null,
    folders: [".claude"],
  })),
};
const NO_TEAMS: readonly LibraryTeam[] = [];
const nothing = async () => undefined;
const ignore = () => undefined;

function Harness({ skills }: { skills: SkillsResult | null }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <LibraryCard
      teams={NO_TEAMS}
      skills={skills}
      readFailure={null}
      open
      read={nothing}
      teach={nothing}
      wakesPaused={false}
      onOpenBoard={ignore}
      styles={styles}
      onClose={ignore}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("an office without a team still lists the host's skills", async () => {
  await act(async () => root.render(<Harness skills={SKILLS} />));
  const card = container.querySelector('section[aria-label="Library"]');
  expect(card?.textContent).toContain("On this host");
  expect(card?.textContent).toContain("deploy");
});

test("before the first reading there is no list of the host's", async () => {
  await act(async () => root.render(<Harness skills={null} />));
  const card = container.querySelector('section[aria-label="Library"]');
  expect(card?.textContent).toContain("Reading the skills on this host.");
  expect(card?.textContent).not.toContain("On this host");
});

test("without a team the host's skills are all shown, and the help about teams is not", async () => {
  await act(async () => root.render(<Harness skills={SEVEN} />));
  const card = container.querySelector('section[aria-label="Library"]');
  for (let index = 1; index <= 7; index += 1) expect(card?.textContent).toContain(`skill-${index}`);
  expect(card?.querySelector('[aria-label="Show 7 skills"]')).toBeNull();
  expect(card?.textContent).not.toContain("Show 7 skills");
  expect(card?.textContent).not.toContain(LIBRARY_HELP);
});
