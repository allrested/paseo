/**
 * @vitest-environment jsdom
 */
// The Incidents card, mounted. The sheet is the host's, so a plain stand-in shows what the card
// passed it; the dismiss call and the link opener are the props the card was given.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Incident, IncidentsState } from "../shared/contracts.js";
import { IncidentsCard } from "./incidents-card.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  return { Modal };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const NOW = Date.parse("2026-11-17T09:00:00Z");
const bug: Incident = {
  id: "jira:SHOP-12",
  source: "jira",
  key: "SHOP-12",
  title: "Checkout fails on Safari",
  url: "https://example.atlassian.net/browse/SHOP-12",
  createdAt: NOW - 60_000,
  foundAt: NOW - 12 * 60_000,
};
const issue: Incident = {
  id: "sentry:API-7",
  source: "sentry",
  key: "API-7",
  title: "TypeError in /orders",
  url: "https://sentry.io/organizations/acme/issues/7/",
  createdAt: NOW - 120_000,
  foundAt: NOW - 3 * 3_600_000,
};
const TWO_OPEN: IncidentsState = {
  open: [issue, bug],
  problems: {},
  jiraReady: true,
  sentryReady: true,
  scheduleError: null,
};

let dismissed: (string[] | undefined)[];
let dismissFailure: Error | null;
let opened: string[];
let openFailure: Error | null;

async function dismiss(ids?: string[]): Promise<void> {
  dismissed.push(ids);
  if (dismissFailure) throw dismissFailure;
}

async function openUrl(url: string): Promise<void> {
  opened.push(url);
  if (openFailure) throw openFailure;
}

const ignore = () => undefined;

function Harness({ state }: { state: IncidentsState | undefined }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <IncidentsCard
      state={state}
      open
      now={NOW}
      onDismiss={dismiss}
      onOpenUrl={openUrl}
      styles={styles}
      onClose={ignore}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  dismissed = [];
  dismissFailure = null;
  opened = [];
  openFailure = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (state: IncidentsState | undefined) =>
  act(async () => root.render(<Harness state={state} />));
const card = () => container.querySelector('section[aria-label="Incidents"]');
const alerts = () =>
  [...container.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);

async function press(selector: string, index = 0): Promise<void> {
  const found = container.querySelectorAll<HTMLElement>(selector)[index];
  if (!found) throw new Error(`Nothing matches ${selector} at ${index}`);
  await act(async () => found.click());
}

test("Dismiss sends the incident's id; Dismiss all sends no ids; a failed dismiss shows its error and the row stays", async () => {
  await mount(TWO_OPEN);
  // Newest first: the Jira bug, found 12 min ago, then the Sentry issue.
  await press('[aria-label="Dismiss"]', 0);
  expect(dismissed).toEqual([["jira:SHOP-12"]]);

  await press('[aria-label="Dismiss all"]');
  expect(dismissed).toEqual([["jira:SHOP-12"], undefined]);

  dismissFailure = new Error("The host is offline");
  await press('[aria-label="Dismiss"]', 1);
  expect(dismissed.at(-1)).toEqual(["sentry:API-7"]);
  expect(alerts()).toEqual(["Unable to dismiss: The host is offline"]);
  expect(card()?.textContent).toContain("TypeError in /orders");
});

test("the title opens the issue's url", async () => {
  await mount(TWO_OPEN);
  expect(card()?.textContent).toContain("Jira SHOP-12 · 12 min ago");
  expect(card()?.textContent).toContain("Sentry API-7 · 3 h ago");
  await press('[aria-label="Open SHOP-12 in Jira"]');
  expect(opened).toEqual(["https://example.atlassian.net/browse/SHOP-12"]);
});

test("a link that does not open says so under its row", async () => {
  openFailure = new Error("No app can open it");
  await mount(TWO_OPEN);
  await press('[aria-label="Open API-7 in Sentry"]');
  expect(alerts()).toEqual(["Unable to open API-7: No app can open it"]);
});

test("nothing open: the card says so, and each tracker's problem is a line at the bottom", async () => {
  await mount({ ...TWO_OPEN, open: [], problems: { jira: "401 Unauthorized" } });
  expect(card()?.textContent).toBe(["No open incidents", "Jira: 401 Unauthorized"].join(""));
  expect(container.querySelector('[aria-label="Dismiss all"]')).toBeNull();

  await mount(undefined);
  expect(card()?.textContent).toBe("No open incidents");
});
