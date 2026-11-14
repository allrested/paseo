import { createIdleRuntimeCleanup } from "../idle-runtime-cleanup/index.js";
import { HostObservationError } from "../host-operations/index.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { WaitForFinishResult } from "@getpaseo/client/internal/daemon-client";
import type { AgentMessageDelivery } from "../agent-messages/index.js";
import { buildStoredAgentPayload } from "../agent-projections.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  createFinishSubscriptions,
  createJsonFinishSubscriptionStore,
  createJsonFinishWatcherStore,
  type FinishObservation,
  type FinishSubscriptions,
} from "./index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Observation implements FinishObservation {
  waits: Array<{ signal: AbortSignal; result: ReturnType<typeof deferred<WaitForFinishResult>> }> =
    [];
  permission = deferred<void>();
  opening: Promise<void> = Promise.resolve();
  openedSignals: AbortSignal[] = [];
  async open(_record: unknown, signal: AbortSignal) {
    this.openedSignals.push(signal);
    await this.opening;
    return { next: () => this.wait(signal), close: async () => {} };
  }
  async wait(signal: AbortSignal) {
    signal.throwIfAborted();
    const result = deferred<WaitForFinishResult>();
    signal.addEventListener("abort", () => result.reject(new Error("Stopped")), { once: true });
    this.waits.push({ signal, result });
    return result.promise;
  }
  afterPermission() {
    return this.permission.promise;
  }
}
class Delivery implements AgentMessageDelivery {
  prompts: string[] = [];
  recipients: string[] = [];
  acknowledgments: Array<ReturnType<typeof deferred<"steered">>> = [];
  enqueue(message: Parameters<AgentMessageDelivery["enqueue"]>[0]) {
    this.recipients.push(message.recipientId);
    this.prompts.push(String(message.prompt));
    const acknowledgment = deferred<"steered">();
    this.acknowledgments.push(acknowledgment);
    return {
      status: "queued" as const,
      messageId: "notification",
      dispatched: acknowledgment.promise,
    };
  }
  async close() {}
  async waitForDispatch() {}
}
const homes: string[] = [];
const services: FinishSubscriptions[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function scenario(directory?: string, removalFailures = 0, retryDelayMs = 1) {
  const home = directory ?? (await mkdtemp(join(tmpdir(), "finish-recovery-")));
  if (!directory) homes.push(home);
  const durableStore = createJsonFinishSubscriptionStore(home);
  const store = {
    ...durableStore,
    async remove(id: string) {
      if (removalFailures > 0) {
        removalFailures--;
        throw new Error("Subscription removal unavailable");
      }
      await durableStore.remove(id);
    },
  };
  const observation = new Observation();
  const delivery = new Delivery();
  let active = true;
  let successor: string | null = null;
  const clock = { now: new Date("2026-11-14T10:00:00.000Z") };
  const service = createFinishSubscriptions({
    store,
    messages: () => delivery,
    open: observation.open.bind(observation),
    resolveCaller: async (agentId) => successor ?? (active ? agentId : null),
    watchers: createJsonFinishWatcherStore(home),
    now: () => clock.now,
    serverId: "origin",
    logger: createTestLogger(),
    retryDelayMs,
  });
  services.push(service);
  await service.start();
  return {
    home,
    store,
    observation,
    delivery,
    service,
    clock,
    archive: () => {
      active = false;
    },
    moveCallerTo: (agentId: string) => {
      active = false;
      successor = agentId;
    },
  };
}
const intent = { callerAgentId: "parent", childAgentId: "child" };
function outcome(status: "idle" | "running" | "closed" | "error" = "closed"): WaitForFinishResult {
  return {
    status: status === "error" ? "error" : "idle",
    final: buildStoredAgentPayload(
      {
        id: "child",
        provider: "codex",
        cwd: "/tmp",
        title: "Child",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        labels: { "paseo.parent-agent-id": "parent" },
        lastStatus: status,
      },
      ["codex"],
      (_provider, own) => own ?? {},
    ),
    lastMessage: "Partial work saved",
    error: null,
  };
}
async function until(check: () => boolean) {
  await expect.poll(check).toBe(true);
}

test("retains intent until parent dispatch acknowledgment, then restart sends nothing", async () => {
  const first = await scenario();
  await first.service.register(intent);
  await until(() => first.observation.waits.length === 1);
  first.observation.waits[0]!.result.resolve(outcome());
  await until(() => first.delivery.prompts.length === 1);
  expect(first.delivery.prompts[0]).toContain("was closed");
  expect(first.delivery.prompts[0]).toContain("Partial work saved");
  expect(await first.store.list()).toHaveLength(1);
  first.delivery.acknowledgments[0]!.resolve("steered");
  await expect.poll(async () => (await first.store.list()).length).toBe(0);
  await first.service.close();
  const restarted = await scenario(first.home);
  expect(restarted.observation.waits).toHaveLength(0);
});

test("restart coalesces predecessor and queued candidate into one settled notification", async () => {
  const first = await scenario();
  await first.service.register(intent);
  await first.service.register(intent, true);
  expect(await first.store.list()).toHaveLength(2);
  await first.service.close();
  const restarted = await scenario(first.home);
  await until(() => restarted.observation.waits.length === 1);
  restarted.observation.waits[0]!.result.resolve(outcome());
  await until(() => restarted.delivery.prompts.length === 1);
  restarted.delivery.acknowledgments[0]!.resolve("steered");
  await expect.poll(async () => (await restarted.store.list()).length).toBe(0);
  expect(restarted.delivery.prompts).toHaveLength(1);
});

test("rejected queued follow-up preserves the predecessor and its buffered finish", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  const pending = await state.service.register(intent, true);
  state.observation.waits[0]!.result.resolve(outcome("idle"));
  await Promise.resolve();
  expect(state.delivery.prompts).toHaveLength(0);
  await pending.reject();
  await until(() => state.delivery.prompts.length === 1);
  expect(await state.store.list()).toHaveLength(1);
});

test("accepted replacement ignores old idle and stale acknowledgment cannot delete new intent", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.observation.waits[0]!.result.resolve(outcome("idle"));
  await until(() => state.delivery.prompts.length === 1);
  const next = await state.service.register(intent, true);
  next.accept();
  await until(() => state.observation.waits.length === 2);
  state.delivery.acknowledgments[0]!.resolve("steered");
  await expect.poll(async () => (await state.store.list()).length).toBe(1);
  state.observation.waits[1]!.result.resolve(outcome("idle"));
  await until(() => state.delivery.prompts.length === 2);
});

test("shutdown before dispatch acknowledgment leaves intent for recovery", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.observation.waits[0]!.result.resolve(outcome());
  await until(() => state.delivery.prompts.length === 1);
  await state.service.close();
  state.delivery.acknowledgments[0]!.resolve("steered");
  const restarted = await scenario(state.home);
  await until(() => restarted.observation.waits.length === 1);
  restarted.observation.waits[0]!.result.resolve(outcome());
  await until(() => restarted.delivery.prompts.length === 1);
});

test("remote recovery before three failed observations still reports child completion", async () => {
  const first = await scenario();
  await first.service.register({ ...intent, serverId: "remote" });
  await first.service.close();
  const state = await scenario(first.home);
  await until(() => state.observation.waits.length === 1);
  state.observation.waits[0]!.result.reject(new HostObservationError("unreachable"));
  await until(() => state.observation.waits.length === 2);
  expect(await state.store.list()).toHaveLength(1);
  expect(state.delivery.prompts).toHaveLength(0);
  state.observation.waits[1]!.result.resolve(outcome("idle"));
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.prompts[0]).toContain("Server: remote");
});

test("archived parent suppresses delivery and removes obsolete intent", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.archive();
  state.observation.waits[0]!.result.resolve(outcome());
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
  expect(state.delivery.prompts).toHaveLength(0);
});

test("a watcher that moved gets the notification at its successor, and the record names it", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.moveCallerTo("parent-2");
  state.observation.waits[0]!.result.resolve(outcome());
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.recipients).toEqual(["parent-2"]);
  expect((await state.store.list()).map((record) => record.callerAgentId)).toEqual(["parent-2"]);
  expect(state.service.hasPendingForCaller("parent-2")).toBe(true);
  expect(state.service.hasPendingForCaller("parent")).toBe(false);
  state.delivery.acknowledgments[0]!.resolve("steered");
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
});

test("withdrawing a notification after its watcher moved leaves nothing behind", async () => {
  const state = await scenario();
  const registration = await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.moveCallerTo("parent-2");
  state.observation.waits[0]!.result.resolve(outcome());
  await until(() => state.delivery.prompts.length === 1);
  expect(state.service.hasPendingForCaller("parent-2")).toBe(true);

  await registration.reject();

  expect(await state.store.list()).toHaveLength(0);
  expect(state.service.hasPendingForCaller("parent-2")).toBe(false);
});

test("a restart after the watcher moved resumes with the successor", async () => {
  const first = await scenario();
  await first.service.register(intent);
  await until(() => first.observation.waits.length === 1);
  first.moveCallerTo("parent-2");
  first.observation.waits[0]!.result.resolve(outcome());
  await until(() => first.delivery.prompts.length === 1);
  await first.service.close();

  const restarted = await scenario(first.home);
  await until(() => restarted.observation.waits.length === 1);
  restarted.observation.waits[0]!.result.resolve(outcome());
  await until(() => restarted.delivery.prompts.length === 1);
  expect(restarted.delivery.recipients).toEqual(["parent-2"]);
});

test("a creation subscription still reports to a watcher that moved", async () => {
  const state = await scenario();
  await state.service.register({ ...intent, requireParentOwnership: true });
  await until(() => state.observation.waits.length === 1);
  state.moveCallerTo("parent-2");
  const reparented = outcome();
  reparented.final!.labels = { "paseo.parent-agent-id": "parent-2" };
  state.observation.waits[0]!.result.resolve(reparented);
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.recipients).toEqual(["parent-2"]);
});

test("a creation subscription for a detached child stops for a watcher that moved too", async () => {
  const state = await scenario();
  await state.service.register({ ...intent, requireParentOwnership: true });
  await until(() => state.observation.waits.length === 1);
  state.moveCallerTo("parent-2");
  const detached = outcome();
  detached.final!.labels = {};
  state.observation.waits[0]!.result.resolve(detached);
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
  expect(state.delivery.prompts).toHaveLength(0);
});

test("permission checkpoint retains intent and completion reports after permission clears", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  const result = outcome("running");
  result.status = "permission";
  result.final!.pendingPermissions = [
    {
      id: "permission",
      name: "Write",
      input: { path: "file" },
      kind: "tool",
    } as (typeof result.final.pendingPermissions)[number],
  ];
  state.observation.waits[0]!.result.resolve(result);
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.prompts[0]).toContain("respond_to_permission");
  expect(await state.store.list()).toHaveLength(1);
  state.delivery.acknowledgments[0]!.resolve("steered");
  state.observation.permission.resolve();
  await until(() => state.observation.waits.length === 2);
  state.observation.waits[1]!.result.resolve(outcome("idle"));
  await until(() => state.delivery.prompts.length === 2);
});

test("coalesced unconditional follow-up survives detachment of a parent-owned creation", async () => {
  const first = await scenario();
  await first.service.register({ ...intent, requireParentOwnership: true });
  await first.service.register(intent, true);
  await first.service.close();
  const restarted = await scenario(first.home);
  await until(() => restarted.observation.waits.length === 1);
  const detached = outcome();
  detached.final!.labels = {};
  restarted.observation.waits[0]!.result.resolve(detached);
  await until(() => restarted.delivery.prompts.length === 1);
});

test("detached child suppresses a parent-owned creation subscription", async () => {
  const state = await scenario();
  await state.service.register({ ...intent, requireParentOwnership: true });
  await until(() => state.observation.waits.length === 1);
  const detached = outcome();
  detached.final!.labels = {};
  state.observation.waits[0]!.result.resolve(detached);
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
  expect(state.delivery.prompts).toHaveLength(0);
});

test("dispatch failure retains intent and retries the ordinary finish notification", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.observation.waits[0]!.result.resolve(outcome());
  await until(() => state.delivery.prompts.length === 1);
  state.delivery.acknowledgments[0]!.reject(new Error("Provider unavailable"));
  await until(() => state.delivery.prompts.length === 2);
  expect(await state.store.list()).toHaveLength(1);
  expect(state.observation.waits).toHaveLength(1);
  state.delivery.acknowledgments[1]!.resolve("steered");
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
});

test("error and missing-child notifications never claim successful completion", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.observation.waits[0]!.result.resolve(outcome("error"));
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.prompts[0]).toContain("errored");
  await state.service.register({ ...intent, childAgentId: "missing-child" });
  await until(() => state.observation.waits.length === 2);
  state.observation.waits[1]!.result.resolve({
    status: "error",
    final: null,
    error: "Agent not found: missing-child",
    lastMessage: null,
  });
  await until(() => state.delivery.prompts.length === 2);
  expect(state.delivery.prompts[1]).toContain("is unavailable");
  expect(state.delivery.prompts[1]).not.toContain("finished");
});

test("finish notification limits a long last response and points to activity for the remainder", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  const result = outcome("idle");
  result.lastMessage = "x".repeat(4100);
  state.observation.waits[0]!.result.resolve(result);
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.prompts[0]).toContain("x".repeat(4000));
  expect(state.delivery.prompts[0]).not.toContain("x".repeat(4001));
  expect(state.delivery.prompts[0]).toContain("get_agent_activity");
});

test("three failed remote observations consume intent only after unavailable-notification acknowledgment", async () => {
  const state = await scenario();
  await state.service.register({ ...intent, serverId: "remote" });
  for (let attempt = 0; attempt < 3; attempt++) {
    await until(() => state.observation.waits.length === attempt + 1);
    expect(state.delivery.prompts).toEqual([]);
    state.observation.waits[attempt]!.result.reject(new HostObservationError("unreachable"));
  }
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.prompts[0]).toContain(
    "Could not observe child agent child on host remote after three failed attempts.",
  );
  expect(state.delivery.prompts[0]).toContain("Status of child agent child (child) is unknown.");
  expect(state.delivery.prompts[0]).not.toContain("finished.");
  expect(await state.store.list()).toHaveLength(1);
  expect(state.observation.waits).toHaveLength(3);
  state.delivery.acknowledgments[0]!.resolve("steered");
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
  await state.service.close();
  const restarted = await scenario(state.home);
  expect(restarted.observation.waits).toEqual([]);
  expect(restarted.delivery.prompts).toEqual([]);
});

test("connecting does not spend the remote failure budget and recovery before three failures still completes", async () => {
  const state = await scenario();
  await state.service.register({ ...intent, serverId: "remote" });
  for (let attempt = 0; attempt < 4; attempt++) {
    await until(() => state.observation.waits.length === attempt + 1);
    expect(state.delivery.prompts).toEqual([]);
    state.observation.waits[attempt]!.result.reject(new HostObservationError("connecting"));
  }
  for (let attempt = 4; attempt < 6; attempt++) {
    await until(() => state.observation.waits.length === attempt + 1);
    expect(state.delivery.prompts).toEqual([]);
    state.observation.waits[attempt]!.result.reject(new HostObservationError("unreachable"));
  }
  await until(() => state.observation.waits.length === 7);
  expect(state.delivery.prompts).toEqual([]);
  state.observation.waits[6]!.result.resolve(outcome("idle"));
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.prompts[0]).toContain("finished.");
});

test("removed-host notice retries parent dispatch without observing again or deleting unacknowledged intent", async () => {
  const state = await scenario();
  await state.service.register({ ...intent, serverId: "remote" });
  await until(() => state.observation.waits.length === 1);
  state.observation.waits[0]!.result.reject(new HostObservationError("removed"));
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.prompts[0]).toContain("Host remote was removed or is unavailable.");
  expect(state.delivery.prompts[0]).toContain("Status of child agent child (child) is unknown.");
  state.delivery.acknowledgments[0]!.reject(new Error("Parent provider unavailable"));
  await until(() => state.delivery.prompts.length === 2);
  expect(state.delivery.prompts[1]).toBe(state.delivery.prompts[0]);
  expect(state.observation.waits).toHaveLength(1);
  expect(await state.store.list()).toHaveLength(1);
  state.delivery.acknowledgments[1]!.resolve("steered");
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
});

test("failed removal after dispatch acknowledgment retries only storage, preserving the accepted outcome", async () => {
  const state = await scenario(undefined, 2, 1000);
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.observation.waits[0]!.result.resolve(outcome("idle"));
  await until(() => state.delivery.prompts.length === 1);
  state.delivery.acknowledgments[0]!.resolve("steered");
  await expect.poll(async () => (await state.store.list()).length, { timeout: 10000 }).toBe(0);
  expect(state.delivery.prompts).toHaveLength(1);
  expect(state.delivery.prompts[0]).toContain("finished.");
  expect(state.observation.waits).toHaveLength(1);
});

test("shutdown during observation setup owns rejection of the already-canceled next result", async () => {
  const state = await scenario();
  const opening = deferred<void>();
  state.observation.opening = opening.promise;
  await state.service.register(intent);
  await until(() => state.observation.openedSignals.length === 1);
  const closing = state.service.close();
  await until(() => state.observation.openedSignals[0]!.aborted);
  opening.resolve();
  await closing;
  expect(await state.store.list()).toHaveLength(1);
  expect(state.delivery.prompts).toEqual([]);
});

test("remote finish intent protects its caller through registration, observation and delivery", async () => {
  const s = await scenario();
  let time = 61 * 60_000;
  let collected = false;
  const runtime = {
    identity: {},
    agentId: "parent",
    parentAgentId: undefined,
    provider: "test",
    sessionId: "parent",
    lastActivityAt: 0,
    isEligible: () => !collected,
    closeIfEligible: async (revalidate: () => boolean) => {
      if (!revalidate()) return false;
      collected = true;
      return true;
    },
  };
  const cleanup = createIdleRuntimeCleanup({
    enabled: true,
    logger: createTestLogger(),
    now: () => time,
    runtimes: () => (collected ? [] : [runtime]),
    isProtected: (agentId) => s.service.hasPendingForCaller(agentId),
    schedule: () => () => {},
  });
  const savedPut = s.store.put.bind(s.store);
  const writing = deferred<void>();
  s.store.put = async (record) => {
    await writing.promise;
    await savedPut(record);
  };
  const registration = s.service.register({ ...intent, serverId: "remote" }, true);
  const protectedDuringRegistration = s.service.hasPendingForCaller?.("parent") ?? false;
  writing.resolve();
  const accepted = await registration;
  expect(protectedDuringRegistration).toBe(true);
  expect((await cleanup.sweep()).collected).toEqual([]);
  expect(s.service.hasPendingForCaller("parent")).toBe(true);
  accepted.accept();
  await until(() => s.observation.waits.length === 1);
  expect(s.service.hasPendingForCaller("parent")).toBe(true);
  s.observation.waits[0]!.result.resolve(outcome());
  await until(() => s.delivery.prompts.length === 1);
  expect(s.service.hasPendingForCaller("parent")).toBe(true);
  s.delivery.acknowledgments[0]!.resolve("steered");
  await until(() => !s.service.hasPendingForCaller("parent"));
  expect(await s.store.list()).toEqual([]);
  time = 62 * 60_000;
  expect((await cleanup.sweep()).collected).toEqual([]);
  time = 122 * 60_000;
  expect((await cleanup.sweep()).collected).toHaveLength(1);
  await cleanup.close();
});

test("finish recovery protects callers before durable intent has loaded", async () => {
  const s = await scenario();
  await s.service.register({ ...intent, serverId: "remote" });
  await s.service.close();
  const loading = deferred<void>();
  const recovered = createFinishSubscriptions({
    store: {
      ...s.store,
      list: async () => {
        await loading.promise;
        return s.store.list();
      },
    },
    messages: () => s.delivery,
    open: s.observation.open.bind(s.observation),
    callerIsActive: async () => true,
    serverId: "origin",
    logger: createTestLogger(),
  });
  services.push(recovered);
  expect(recovered.hasPendingForCaller("parent")).toBe(true);
  const starting = recovered.start();
  expect(recovered.hasPendingForCaller("parent")).toBe(true);
  loading.resolve();
  await starting;
  expect(recovered.hasPendingForCaller("parent")).toBe(true);
  expect(recovered.hasPendingForCaller("unrelated")).toBe(false);
});

/** Registers `intent`, ends the child's turn with `ending`, and waits for the delivery to settle. */
async function tellParent(
  state: Awaited<ReturnType<typeof scenario>>,
  ending: Parameters<typeof outcome>[0],
): Promise<void> {
  const waits = state.observation.waits.length;
  const prompts = state.delivery.prompts.length;
  await state.service.register(intent);
  await until(() => state.observation.waits.length === waits + 1);
  state.observation.waits[waits]!.result.resolve(outcome(ending));
  await until(() => state.delivery.prompts.length === prompts + 1);
  state.delivery.acknowledgments[prompts]!.resolve("steered");
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
}

test("names a caller that still waits on an agent, for a move to tell it about the successor", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await state.service.register({ ...intent, callerAgentId: "far", serverId: "remote" });
  await until(() => state.observation.waits.length === 2);

  // The watch on an agent of another host is that host's move to follow.
  expect(state.service.watchersOf("child")).toEqual(["parent"]);
  expect(state.service.watchersOf("someone-else")).toEqual([]);
});

test("names a caller that was told the agent's turn failed, and one told it was closed", async () => {
  const failed = await scenario();
  await tellParent(failed, "error");
  expect(failed.service.watchersOf("child")).toEqual(["parent"]);

  const closed = await scenario();
  await tellParent(closed, "closed");
  expect(closed.service.watchersOf("child")).toEqual(["parent"]);
});

test("does not name a caller whose request finished: it has its answer", async () => {
  const state = await scenario();

  await tellParent(state, "idle");

  expect(state.delivery.prompts[0]).toContain("finished");
  expect(state.service.watchersOf("child")).toEqual([]);
});

test("forgets who was told once the agent completes a turn", async () => {
  const state = await scenario();
  await tellParent(state, "error");

  state.service.forgetWatchers("someone-else");
  expect(state.service.watchersOf("child")).toEqual(["parent"]);
  state.service.forgetWatchers("child");

  expect(state.service.watchersOf("child")).toEqual([]);
  await state.service.close();
  const restarted = await scenario(state.home);
  expect(restarted.service.watchersOf("child")).toEqual([]);
});

test("still names who was told after a daemon restart", async () => {
  const first = await scenario();
  await tellParent(first, "error");
  await first.service.close();

  const restarted = await scenario(first.home);

  expect(restarted.service.watchersOf("child")).toEqual(["parent"]);
});

test("drops what it remembers after a week", async () => {
  const state = await scenario();
  await tellParent(state, "error");
  await state.service.close();

  state.clock.now = new Date("2026-11-22T10:00:00.000Z");
  const later = await scenario(state.home);
  later.clock.now = new Date("2026-11-22T10:00:00.000Z");

  expect(later.service.watchersOf("child")).toEqual([]);
});

test("starts with nobody remembered when the file of who was told cannot be read", async () => {
  const first = await scenario();
  await tellParent(first, "error");
  await first.service.close();
  await writeFile(join(first.home, "finish-watchers.json"), "{not json");

  const restarted = await scenario(first.home);

  expect(restarted.service.watchersOf("child")).toEqual([]);
});
