import { setTimeout as pause } from "node:timers/promises";
import { HostObservationError } from "../host-operations/index.js";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { WaitForFinishResult } from "@getpaseo/client/internal/daemon-client";
import type { FinishObservationResult } from "./internal/observation-buffer.js";
import type { AgentMessageDelivery } from "../agent-messages/index.js";
import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import {
  formatFinishNotificationBody,
  finishNotificationEvents,
  type FinishNotificationReason,
} from "./internal/notification.js";
export {
  createJsonFinishSubscriptionStore,
  createJsonFinishWatcherStore,
} from "./internal/json-store.js";

export interface FinishSubscription {
  id: string;
  callerAgentId: string;
  childAgentId: string;
  serverId?: string;
  /** Creation subscriptions stop reporting after the child is detached. */
  requireParentOwnership?: boolean;
}
export interface FinishSubscriptionStore {
  list(): Promise<FinishSubscription[]>;
  put(subscription: FinishSubscription): Promise<void>;
  remove(id: string): Promise<void>;
}
/** A caller that was told about the end of a turn of an agent on this host. */
export interface FinishWatcher {
  childAgentId: string;
  callerAgentId: string;
  at: string;
}
export interface FinishWatcherStore {
  list(): Promise<FinishWatcher[]>;
  replace(watchers: FinishWatcher[]): Promise<void>;
}
export interface FinishObservationSession {
  next(): Promise<FinishObservationResult>;
  close(): Promise<void>;
}
export interface FinishObservation {
  open(subscription: FinishSubscription, signal: AbortSignal): Promise<FinishObservationSession>;
}
interface Dependencies extends FinishObservation {
  store: FinishSubscriptionStore;
  messages(): AgentMessageDelivery;
  /**
   * Who to tell for this caller: itself while it is active, the agent its session moved to, or
   * null when neither exists.
   */
  resolveCaller(agentId: string): Promise<string | null>;
  /** Left out, who was told is remembered only until the daemon stops. */
  watchers?: FinishWatcherStore;
  now?: () => Date;
  serverId: string;
  logger: Logger;
  retryDelayMs?: number;
}
export interface FinishRegistration {
  /** The prompt was accepted. Replaces preceding registrations for this pair. */
  accept(): void;
  /** Rejected dispatch preserves preceding registrations. */
  reject(): Promise<void>;
}
export interface FinishSubscriptions {
  start(): Promise<void>;
  /** Pending notification intent, including registration, recovery and unacknowledged delivery. */
  hasPendingForCaller(agentId: string): boolean;
  /**
   * The callers that wait on `childAgentId`, or were told that a turn of it failed, was
   * cancelled or was closed. A session move reads this: their notification is spent while the
   * work they asked for is not done, so these are who to tell when the successor finishes. A
   * caller told that the turn finished has its answer and is not named. Agents on this host only.
   */
  watchersOf(childAgentId: string): string[];
  /** The agent completed a turn: whoever was told about an earlier failure no longer waits. */
  forgetWatchers(childAgentId: string): void;
  register(
    input: Omit<FinishSubscription, "id">,
    pendingDispatch?: boolean,
  ): Promise<FinishRegistration>;
  close(): Promise<void>;
}
interface Watch {
  records: FinishSubscription[];
  controller: AbortController;
  decision: Promise<boolean>;
  decide(accepted: boolean): void;
  pending: boolean;
  task?: Promise<void>;
}
function key(record: FinishSubscription): string {
  return JSON.stringify([record.callerAgentId, record.childAgentId, record.serverId]);
}

/** Owns durable intent, live observation, supersession, and dispatch acknowledgment. */
export function createFinishSubscriptions(deps: Dependencies): FinishSubscriptions {
  const tasks = new Set<Promise<void>>();
  let told: FinishWatcher[] = [];
  /** Long enough to move an agent the morning after its limit; nothing reads an older entry. */
  const TOLD_FOR_MS = 7 * 24 * 60 * 60 * 1000;
  function currentTime(): Date {
    return (deps.now ?? (() => new Date()))();
  }
  function isFresh(entry: FinishWatcher, at: Date): boolean {
    return at.getTime() - Date.parse(entry.at) < TOLD_FOR_MS;
  }
  /** The latest write of who was told, so close can wait for it. */
  let savingTold: Promise<void> = Promise.resolve();
  function saveTold(): void {
    if (!deps.watchers) return;
    savingTold = deps.watchers.replace(told).catch((error: unknown) => {
      deps.logger.warn({ err: error }, "Failed to save finish watchers");
    });
  }
  function noteTold(record: FinishSubscription): void {
    // A watch on an agent of another host is that host's move to follow.
    if (record.serverId) return;
    const at = currentTime();
    told = told.filter(
      (entry) =>
        isFresh(entry, at) &&
        !(
          entry.childAgentId === record.childAgentId && entry.callerAgentId === record.callerAgentId
        ),
    );
    told.push({
      childAgentId: record.childAgentId,
      callerAgentId: record.callerAgentId,
      at: at.toISOString(),
    });
    saveTold();
  }
  const watches = new Map<string, Set<Watch>>();
  let closed = false;
  let recovering = true;
  const registering = new Map<string, number>();
  let mutations = Promise.resolve();
  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = mutations.then(action);
    mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  function attach(records: FinishSubscription[], pending: boolean): Watch {
    let decide!: Watch["decide"];
    const decision = new Promise<boolean>((resolve) => {
      decide = resolve;
    });
    const watch: Watch = { records, controller: new AbortController(), pending, decision, decide };
    const group = watches.get(key(records[0]!)) ?? new Set<Watch>();
    group.add(watch);
    watches.set(key(records[0]!), group);
    if (!pending) decide(true);
    watch.task = run(watch, group).catch((error) =>
      deps.logger.error({ err: error }, "Finish subscription failed"),
    );
    tasks.add(watch.task);
    void watch.task.then(() => tasks.delete(watch.task!));
    return watch;
  }
  /** `group` is where the caller last saw the watch; a re-pointed watch sits under a newer key. */
  function stop(watch: Watch, group: Set<Watch>): void {
    watch.controller.abort();
    watch.decide(false);
    const current = key(watch.records[0]!);
    for (const holder of new Set([group, watches.get(current)])) {
      if (!holder) continue;
      holder.delete(watch);
      if (!holder.size && watches.get(current) === holder) watches.delete(current);
    }
  }
  async function remove(watch: Watch): Promise<void> {
    // Only IDs captured by this observer are eligible; newer registrations survive.
    for (const record of watch.records) await deps.store.remove(record.id);
  }
  async function delay(signal: AbortSignal, attempt: number): Promise<void> {
    try {
      await pause(
        Math.min((deps.retryDelayMs ?? 1000) * 2 ** Math.min(attempt, 3), 5000),
        undefined,
        { signal },
      );
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
  async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    let abort!: () => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([operation, cancellation]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async function decisions(group: Set<Watch>): Promise<void> {
    // New candidates may arrive while an older dispatch decision is pending.
    while (true) {
      if (closed) return;
      const pending = [...group].filter((watch) => watch.pending);
      if (!pending.length) return;
      await Promise.all(pending.map((watch) => watch.decision));
    }
  }
  /** A creation subscription stops reporting once the child no longer belongs to the caller. */
  function detached(record: FinishSubscription, result: WaitForFinishResult): boolean {
    if (!record.requireParentOwnership || !result.final) return false;
    const parent = getParentAddressFromLabels(
      result.final.labels,
      record.serverId ?? deps.serverId,
    );
    return parent?.agentId !== record.callerAgentId || parent.serverId !== deps.serverId;
  }
  /** Files a watch whose records changed pair under its new key and returns that group. */
  function refile(watch: Watch, group: Set<Watch>, records: FinishSubscription[]): Set<Watch> {
    group.delete(watch);
    if (!group.size && watches.get(key(watch.records[0]!)) === group)
      watches.delete(key(watch.records[0]!));
    watch.records = records;
    const next = watches.get(key(records[0]!)) ?? new Set<Watch>();
    next.add(watch);
    watches.set(key(records[0]!), next);
    return next;
  }
  function reasonFor(result: FinishObservationResult): FinishNotificationReason {
    if (result.reason === "host unreachable" || result.reason === "host removed")
      return result.reason;
    if (!result.final) return "is unavailable";
    if (result.final.status === "closed") return "was closed";
    if (result.status === "error") return "errored";
    if (result.status === "permission") return "needs permission";
    return result.reason ?? "finished";
  }
  async function deliver(
    record: FinishSubscription,
    result: FinishObservationResult,
    permissions: Set<string>,
    signal: AbortSignal,
  ): Promise<boolean> {
    const requests = result.final?.pendingPermissions ?? [];
    const reason = reasonFor(result);
    for (const id of permissions)
      if (!requests.some((request) => request.id === id)) permissions.delete(id);
    const acknowledgments: Promise<unknown>[] = [];
    for (const request of reason === "needs permission" ? requests : [undefined]) {
      if (signal.aborted) return false;
      if (request && permissions.has(request.id)) continue;
      const title = result.final?.title ?? record.childAgentId;
      const receipt = deps.messages().enqueue({
        recipientId: record.callerAgentId,
        prompt: formatFinishNotificationBody({
          childAgentId: record.childAgentId,
          serverId: record.serverId ?? deps.serverId,
          title,
          reason,
          lastAssistantMessage: result.lastMessage,
          permissionRequest: request,
        }),
        source: {
          kind: "agent-notification",
          agentId: record.childAgentId,
          serverId: record.serverId ?? deps.serverId,
          title,
          event: finishNotificationEvents[reason],
        },
        activeTurnBehavior: "steer",
        unarchive: false,
      });
      acknowledgments.push(
        receipt.dispatched.then(() => {
          if (request) permissions.add(request.id);
          return undefined;
        }),
      );
    }
    await abortable(Promise.all(acknowledgments), signal);
    if (signal.aborted) return false;
    if (reason !== "needs permission") return true;
    return false;
  }
  async function run(watch: Watch, initialGroup: Set<Watch>): Promise<void> {
    const signal = watch.controller.signal;
    if (!(await watch.decision) || signal.aborted) return;
    let group = initialGroup;
    let record = {
      ...watch.records[0]!,
      requireParentOwnership: watch.records.every(
        (intent) => intent.requireParentOwnership === true,
      ),
    };
    /** False when nobody is left to tell. A caller that moved is replaced by its successor. */
    async function followCaller(): Promise<boolean> {
      const caller = await deps.resolveCaller(record.callerAgentId);
      if (caller === null) return false;
      // A watch stopped meanwhile is neither saved again nor filed again; the loop ends it.
      if (caller === record.callerAgentId || signal.aborted) return true;
      const records = watch.records.map((intent) => ({ ...intent, callerAgentId: caller }));
      for (const intent of records) await deps.store.put(intent);
      if (signal.aborted) {
        for (const intent of records) await deps.store.remove(intent.id);
        return true;
      }
      group = refile(watch, group, records);
      record = { ...record, callerAgentId: caller };
      return true;
    }
    const permissions = new Set<string>();
    let observation: FinishObservationSession | undefined;
    let pending: FinishObservationResult | undefined;
    let acknowledged = false;
    let noted = false;
    let remoteFailures = 0;
    let retries = 0;
    let warned = false;
    async function observeNext(): Promise<FinishObservationResult | undefined> {
      try {
        observation ??= await deps.open(record, signal);
        const result = await abortable(observation.next(), signal);
        remoteFailures = 0;
        return result;
      } catch (error) {
        await observation?.close();
        observation = undefined;
        signal.throwIfAborted();
        if (!(error instanceof HostObservationError) || !record.serverId) throw error;
        if (error.reason === "connecting") return undefined;
        if (error.reason === "unreachable" && ++remoteFailures < 3) return undefined;
        // Host visibility ends this subscription; it says nothing about child completion.
        return {
          status: "error",
          final: null,
          lastMessage: null,
          error: null,
          reason: error.reason === "removed" ? "host removed" : "host unreachable",
        };
      }
    }
    try {
      while (!signal.aborted) {
        try {
          if (!(await followCaller())) {
            await remove(watch);
            stop(watch, group);
            return;
          }
          if (!pending) pending = await observeNext();
          if (!pending) {
            await delay(signal, retries++);
            continue;
          }
          if (signal.aborted) return;
          await decisions(group);
          if (signal.aborted) return;
          if (!(await followCaller()) || detached(record, pending)) {
            await remove(watch);
            stop(watch, group);
            return;
          }
          // A turn that failed, was cancelled or was closed leaves the caller's request undone.
          if (!noted && ["errored", "was canceled", "was closed"].includes(reasonFor(pending))) {
            noteTold(record);
            noted = true;
          }
          if (!acknowledged) acknowledged = await deliver(record, pending, permissions, signal);
          if (acknowledged) {
            // A removal failure retries only the commit, never the already accepted callback.
            await remove(watch);
            stop(watch, group);
            return;
          }
          pending = undefined;
          retries = 0;
          warned = false;
        } catch (error) {
          if (signal.aborted) return;
          // Delivery and storage failures retain the captured outcome and durable intent.
          // They do not spend the remote-observation budget or change the child's outcome.
          if (!warned) {
            deps.logger.warn(
              { err: error, subscription: record.id },
              "Retrying finish subscription",
            );
            warned = true;
          }
          await delay(signal, retries++);
        }
      }
    } finally {
      await observation?.close();
    }
  }

  return {
    hasPendingForCaller(agentId) {
      if (recovering || registering.has(agentId)) return true;
      for (const group of watches.values()) {
        for (const watch of group) if (watch.records[0]!.callerAgentId === agentId) return true;
      }
      return false;
    },
    watchersOf(childAgentId) {
      const at = currentTime();
      const callers = new Set<string>();
      for (const entry of told) {
        if (entry.childAgentId === childAgentId && isFresh(entry, at)) {
          callers.add(entry.callerAgentId);
        }
      }
      for (const group of watches.values()) {
        for (const watch of group) {
          const record = watch.records[0]!;
          if (watch.pending || record.serverId || record.childAgentId !== childAgentId) continue;
          callers.add(record.callerAgentId);
        }
      }
      return [...callers];
    },
    forgetWatchers(childAgentId) {
      if (!told.some((entry) => entry.childAgentId === childAgentId)) return;
      told = told.filter((entry) => entry.childAgentId !== childAgentId);
      saveTold();
    },
    start: () =>
      serialize(async () => {
        // A memory aid, never a reason to fail the start. What was noted before this read is kept.
        const saved = await (deps.watchers?.list() ?? Promise.resolve([])).catch(
          (error: unknown): FinishWatcher[] => {
            deps.logger.warn({ err: error }, "Failed to read finish watchers");
            return [];
          },
        );
        const noted = new Set(told.map((entry) => `${entry.childAgentId}\n${entry.callerAgentId}`));
        told = [
          ...saved.filter((entry) => !noted.has(`${entry.childAgentId}\n${entry.callerAgentId}`)),
          ...told,
        ];
        const groups = new Map<string, FinishSubscription[]>();
        for (const record of await deps.store.list()) {
          const records = groups.get(key(record)) ?? [];
          records.push(record);
          groups.set(key(record), records);
        }
        for (const records of groups.values()) attach(records, false);
        recovering = false;
      }),
    register: (input, pendingDispatch = false) => {
      registering.set(input.callerAgentId, (registering.get(input.callerAgentId) ?? 0) + 1);
      return serialize(async () => {
        if (closed) throw new Error("Finish subscriptions are closed");
        const record: FinishSubscription = {
          ...input,
          serverId: input.serverId === deps.serverId ? undefined : input.serverId,
          id: randomUUID(),
        };
        await deps.store.put(record);
        const group = watches.get(key(record)) ?? new Set<Watch>();
        const predecessors = [...group];
        const watch = attach([record], true);
        const actualGroup = watches.get(key(record))!;
        const registration: FinishRegistration = {
          accept() {
            if (!watch.pending || closed) return;
            watch.pending = false;
            for (const prior of predecessors) stop(prior, actualGroup);
            watch.decide(true);
            void serialize(async () => {
              for (const prior of predecessors) await remove(prior);
            }).catch((error) =>
              deps.logger.error({ err: error }, "Failed to remove superseded finish subscriptions"),
            );
          },
          reject: () =>
            serialize(async () => {
              await remove(watch);
              stop(watch, actualGroup);
            }),
        };
        if (!pendingDispatch) registration.accept();
        return registration;
      }).finally(() => {
        const remaining = registering.get(input.callerAgentId)! - 1;
        if (remaining) registering.set(input.callerAgentId, remaining);
        else registering.delete(input.callerAgentId);
      });
    },
    async close() {
      closed = true;
      await mutations;
      for (const group of watches.values())
        for (const watch of group) {
          watch.controller.abort();
          watch.decide(false);
        }
      await mutations;
      await Promise.all(tasks);
      await savingTold;
      await deps.store.list();
      // Dispatch may still be pending. The delivery owner drains it after observers stop.
    },
  };
}

export { createFinishObservation } from "./internal/observation.js";
