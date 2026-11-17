/**
 * @vitest-environment jsdom
 */
// The agent card's "Open session", mounted: the card stays open while the session is beside the
// floor, and closes when the session opens in its workspace. The sheet and its input are the
// host's, so plain stand-ins show what the card passed them.
import { act, createElement, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginBesideTarget, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import { AgentCard } from "./agent-card.js";
import { useOfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  return { Modal, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const AGENT: OfficeAgent = {
  id: "a1",
  title: "Builder",
  provider: "claude",
  model: "opus",
  status: "idle",
  workspaceId: "w1",
  parentAgentId: null,
  permissions: [],
  createdAt: "2026-11-17T08:00:00.000Z",
};
const nothing = async () => undefined;
const ACTIONS: AgentActions = { send: nothing, respond: nothing, cancel: nothing };

type Navigation = NonNullable<PluginSurfaceProps["navigation"]>;

let shown: PluginBesideTarget[];
let opened: string[];

/** The app's navigation; `answer` is what its side area says, null when the app has none. */
function navigation(answer: boolean | null): Navigation {
  return {
    openAgent: ({ agentId }) => {
      opened.push(agentId);
    },
    openWorkspace: () => {},
    ...(answer === null
      ? {}
      : {
          showBeside: (target: PluginBesideTarget) => {
            shown.push(target);
            return answer;
          },
        }),
  };
}

function Harness({ nav }: { nav: Navigation }) {
  const styles = useOfficeStyles(THEME, false, false);
  const [agent, setAgent] = useState<OfficeAgent | null>(AGENT);
  const close = useCallback(() => setAgent(null), []);
  return (
    <AgentCard
      agent={agent}
      activity={null}
      actions={ACTIONS}
      navigation={nav}
      styles={styles}
      onClose={close}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  shown = [];
  opened = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
const card = () => container.querySelector('section[aria-label="Builder"]');

async function openSession(nav: Navigation): Promise<void> {
  await act(async () => root.render(<Harness nav={nav} />));
  const button = container.querySelector<HTMLElement>('[aria-label="Open session"]');
  if (!button) throw new Error('Nothing is labelled "Open session"');
  await act(async () => button.click());
  await settle();
}

test("the card stays open beside the session", async () => {
  await openSession(navigation(true));
  expect(shown).toEqual([{ kind: "agent", agentId: "a1" }]);
  expect(opened).toEqual([]);
  expect(card()).not.toBeNull();
});

test("the card closes when the session opens in its workspace instead", async () => {
  await openSession(navigation(false));
  expect(opened).toEqual(["a1"]);
  expect(card()).toBeNull();
});

test("on an app without a side area the card closes as the session opens", async () => {
  await openSession(navigation(null));
  expect(opened).toEqual(["a1"]);
  expect(card()).toBeNull();
});
