/**
 * @vitest-environment jsdom
 */
// The sidebar's task badge, mounted once per workspace row as the host does. The badge is the
// host's, so a plain element shows what it was given; the RPC is the test's.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import type { PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import type { LinkedWorkspaces } from "../shared/contracts.js";
import { REFRESH_MS } from "./linked.js";
import { TaskBadge, forgetAsked } from "./workspace-badge.js";

interface BadgeProps {
  icon: string;
  label: string;
  tone?: string;
  accessibilityLabel?: string;
}

vi.mock("@getpaseo/plugin/client/ui", () => ({
  WorkspaceRowBadge: ({ icon, label, tone, accessibilityLabel }: BadgeProps) =>
    createElement(
      "span",
      { "data-badge": "", "data-icon": icon, "data-tone": tone, "aria-label": accessibilityLabel },
      label,
    ),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const JIRA = {
  workspaceId: "wks_1",
  name: "BWLT-12-add-the-webhook",
  key: "BWLT-12",
  url: "https://team.atlassian.net/browse/BWLT-12",
  taskId: "jira:BWLT-12",
  status: "In Review",
  phase: "doing" as const,
};
const GITLAB = {
  workspaceId: "wks_2",
  name: "7-rate-limit",
  key: "shop/web#7",
  url: "https://git.team.test/shop/web/-/issues/7",
  taskId: "gitlab:issue:42:7",
  status: "Closed",
  phase: "done" as const,
};

let reads: number;
let answer: LinkedWorkspaces | Error;
let container: HTMLElement;
let root: Root;
let client: QueryClient;

async function invoke(method: string): Promise<unknown> {
  if (method !== "tasks.workspaces.linked") throw new Error(`Unexpected call ${method}`);
  reads += 1;
  if (answer instanceof Error) throw answer;
  return answer;
}

const subscribe = () => {
  throw new Error("The badge subscribes to nothing");
};

function props(workspaceId: string): PluginWorkspaceRowBadgeItemProps {
  return {
    theme: { colors: new Proxy({}, { get: () => "#808080" }) },
    layout: { compact: false, platform: "web" },
    host: { id: "host", label: "Host" },
    workspaceId,
  } as unknown as PluginWorkspaceRowBadgeItemProps;
}

const settle = (ms = 0) =>
  act(async () => void (await new Promise((done) => setTimeout(done, ms))));

async function mount(...workspaceIds: string[]): Promise<void> {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
          {workspaceIds.map((id) => (
            <div key={id} data-row={id}>
              <TaskBadge {...props(id)} />
            </div>
          ))}
        </PluginRpcProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function badge(workspaceId: string): HTMLElement | null {
  return container.querySelector(`[data-row="${workspaceId}"] [data-badge]`);
}

beforeEach(() => {
  reads = 0;
  answer = { workspaceIds: ["wks_1", "wks_2", "wks_3"], linked: [JIRA, GITLAB] };
  forgetAsked();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.useRealTimers();
});

test("a workspace started on a task shows the task and how it stands; the others show nothing", async () => {
  await mount("wks_1", "wks_2", "wks_3");
  expect(badge("wks_1")?.textContent).toBe("BWLT-12 · In Review");
  expect(badge("wks_1")?.getAttribute("aria-label")).toBe("Task BWLT-12, In Review");
  expect(badge("wks_1")?.dataset.icon).toBe("CircleDot");
  expect(badge("wks_3")).toBeNull();
});

test("every row is answered by one request", async () => {
  await mount("wks_1", "wks_2", "wks_3");
  expect(reads).toBe(1);
});

test("GitLab's key is cut to the task's number: the row is narrow and the project is its own", async () => {
  await mount("wks_2");
  expect(badge("wks_2")?.textContent).toBe("#7 · Closed");
  expect(badge("wks_2")?.getAttribute("aria-label")).toBe("Task shop/web#7, Closed");
});

test("the badge's colour says where the status stands", async () => {
  const todo = { ...JIRA, workspaceId: "wks_3", status: "To Do", phase: "todo" as const };
  const { phase: _none, ...unknown } = { ...JIRA, workspaceId: "wks_4", status: "Paused" };
  answer = {
    workspaceIds: ["wks_1", "wks_2", "wks_3", "wks_4"],
    linked: [JIRA, GITLAB, todo, unknown],
  };
  await mount("wks_1", "wks_2", "wks_3", "wks_4");
  expect(["wks_1", "wks_2", "wks_3", "wks_4"].map((id) => badge(id)?.dataset.tone)).toEqual([
    "info",
    "success",
    "muted",
    "muted",
  ]);
});

test("a task whose tracker could not be asked shows by its key alone", async () => {
  const { status: _status, phase: _phase, ...bare } = JIRA;
  answer = { workspaceIds: ["wks_1"], linked: [bare] };
  await mount("wks_1");
  expect(badge("wks_1")?.textContent).toBe("BWLT-12");
  expect(badge("wks_1")?.getAttribute("aria-label")).toBe("Task BWLT-12");
  expect(badge("wks_1")?.dataset.tone).toBe("muted");
});

test("a list that cannot be read shows no badge", async () => {
  answer = new Error(
    "Request failed: boom requestType=plugin.rpc.invoke.request code=handler_error",
  );
  await mount("wks_1");
  expect(badge("wks_1")).toBeNull();
});

test("a workspace made after the answer asks once more, and a row the host never lists asks only once", async () => {
  await mount("wks_1");
  expect(reads).toBe(1);
  const made = { ...JIRA, workspaceId: "wks_9" };
  answer = { workspaceIds: ["wks_1", "wks_9"], linked: [JIRA, made] };
  await mount("wks_1", "wks_9");
  expect(reads).toBe(2);
  expect(badge("wks_9")?.textContent).toBe("BWLT-12 · In Review");
  // A row for a workspace the list leaves out: one more read, then no more.
  await mount("wks_1", "wks_9", "wks_gone");
  expect(reads).toBe(3);
  await mount("wks_1", "wks_9", "wks_gone");
  await settle(20);
  expect(reads).toBe(3);
});

test("the statuses are read again every five minutes", async () => {
  vi.useFakeTimers();
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
          <div data-row="wks_1">
            <TaskBadge {...props("wks_1")} />
          </div>
        </PluginRpcProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  expect(reads).toBe(1);
  answer = { workspaceIds: ["wks_1"], linked: [{ ...JIRA, status: "Done", phase: "done" }] };
  await act(async () => void (await vi.advanceTimersByTimeAsync(REFRESH_MS - 1000)));
  expect(reads).toBe(1);
  await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
  expect(reads).toBe(2);
  // The answer reaches the rows on the query client's next tick.
  await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
  expect(badge("wks_1")?.textContent).toBe("BWLT-12 · Done");
});
