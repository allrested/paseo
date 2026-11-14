import { describe, expect, test } from "vitest";
import type { MaestroRunState } from "../shared/contracts.js";
import type { MaestroRunner } from "./maestro.js";
import { buildMaestroPrompt, registerMaestro } from "./maestro-rpc.js";

type Handler = (input: object, context: object) => Promise<unknown>;

const FAILED: MaestroRunState = {
  id: "run-1",
  flow: ".maestro/login.yaml",
  status: "failed",
  startedAt: 1,
  endedAt: 2,
  failedStep: 'Tap on "Login"',
  message: "Element not found",
  hasPicture: true,
  output: ['Tap on "Login"... FAILED'],
};

function setup(state: MaestroRunState | null = FAILED) {
  const handlers = new Map<string, Handler>();
  const calls: unknown[][] = [];
  let listener: ((run: MaestroRunState | null) => void) | null = null;
  const runner = {
    flows: async (dir: string) => (calls.push(["flows", dir]), [".maestro/login.yaml"]),
    start: async (input: object) => (calls.push(["start", input]), { ok: true }),
    stop: async () => void calls.push(["stop"]),
    state: () => state,
    watch: (next: (run: MaestroRunState | null) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    failurePicture: async () => Buffer.from("png"),
    close: async () => undefined,
  } as unknown as MaestroRunner;
  registerMaestro(
    {
      handle: ((contract: { name: string }, handler: Handler) =>
        handlers.set(contract.name, handler)) as never,
    },
    runner,
    () => undefined,
  );
  const sent: unknown[][] = [];
  const paseo = {
    workspaces: {
      ref: (id: string) => ({
        refresh: async () =>
          id === "w1" ? { workspaceDirectory: "/work/app", projectRootPath: "/work" } : null,
      }),
    },
    agents: {
      list: async () => ({
        entries: [
          { agent: { id: "a1", workspaceId: "w1", title: "Builder", archivedAt: null } },
          { agent: { id: "a2", workspaceId: "w2", title: "Other", archivedAt: null } },
          { agent: { id: "a3", workspaceId: "w1", title: "Old", archivedAt: "2026-11-01" } },
        ],
      }),
      ref: (id: string) => ({
        send: async (text: string, options: object) => void sent.push([id, text, options]),
      }),
    },
  };
  const call = (name: string, input: object, context: object = {}) =>
    (handlers.get(name) as Handler)(input, { paseo, ...context });
  return {
    call,
    calls,
    sent,
    emit: (run: MaestroRunState | null) => listener?.(run),
    isWatched: () => listener !== null,
  };
}

describe("Maestro RPCs", () => {
  test("lists and starts flows in the workspace's own folder", async () => {
    const { call, calls } = setup();
    expect(await call("android.maestro.flows.request", { workspaceId: "w1" })).toEqual({
      flows: [".maestro/login.yaml"],
    });
    expect(
      await call("android.maestro.start.request", {
        workspaceId: "w1",
        flow: ".maestro/login.yaml",
      }),
    ).toEqual({ ok: true });
    expect(calls).toEqual([
      ["flows", "/work/app"],
      ["start", { dir: "/work/app", flow: ".maestro/login.yaml" }],
    ]);
    expect(await call("android.maestro.flows.request", { workspaceId: "w9" })).toEqual({
      flows: [],
      error: "This workspace has no folder",
    });
  });

  test("streams the run until the viewer leaves", async () => {
    const { call, emit, isWatched } = setup();
    const pushed: unknown[] = [];
    const controller = new AbortController();
    const done = call(
      "android.maestro.run",
      {},
      { signal: controller.signal, push: async (event: unknown) => void pushed.push(event) },
    );
    emit({ ...FAILED, status: "running" });
    controller.abort();
    await done;
    expect(pushed).toEqual([{ run: FAILED }, { run: { ...FAILED, status: "running" } }]);
    expect(isWatched()).toBe(false);
  });

  test("lists the workspace's live agents", async () => {
    const { call } = setup();
    expect(await call("android.maestro.agents.request", { workspaceId: "w1" })).toEqual({
      agents: [{ id: "a1", title: "Builder" }],
    });
  });

  test("sends a finished run to an agent as one prompt with the failure picture", async () => {
    const { call, sent } = setup();
    expect(
      await call("android.maestro.send.request", { runId: "run-1", agentId: "a1", note: "fix it" }),
    ).toEqual({ ok: true });
    expect(sent).toEqual([
      [
        "a1",
        buildMaestroPrompt(FAILED, "fix it"),
        { activeTurnBehavior: "steer", images: [{ mimeType: "image/png", data: "cG5n" }] },
      ],
    ]);
    expect(
      await call("android.maestro.send.request", { runId: "run-0", agentId: "a1", note: "" }),
    ).toEqual({ ok: false, error: "That run is no longer the last one" });
  });

  test("does not send a run that is still going", async () => {
    const { call } = setup({ ...FAILED, status: "running" });
    expect(
      await call("android.maestro.send.request", { runId: "run-1", agentId: "a1", note: "" }),
    ).toEqual({ ok: false, error: "The flow is still running" });
  });

  test("the prompt names the flow, the failing step, the message and the output", () => {
    expect(buildMaestroPrompt(FAILED, "")).toBe(
      [
        "Look into this Maestro run.",
        "",
        'The Maestro flow .maestro/login.yaml failed at "Tap on \\"Login\\"" on the stack\'s Android device.',
        "Message: Element not found",
        "The attached picture is the screen when it failed.",
        "",
        "Last output:",
        "```",
        'Tap on "Login"... FAILED',
        "```",
      ].join("\n"),
    );
  });
});
