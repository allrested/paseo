import { describe, expect, it } from "vitest";
import {
  decideAdmission,
  type AdmissionInput,
  type HeldCommand,
  type QueuedCommand,
} from "./admission.js";

const GIB = 1024 ** 3;
const NOW = 10_000_000;
const STARVATION_MS = 300_000;

function queued(id: string, estimateGb: number, waitedMs = 0): QueuedCommand {
  return { id, estimateBytes: estimateGb * GIB, queuedAt: NOW - waitedMs };
}

function held(estimateGb: number, rssGb: number | null): HeldCommand {
  return { estimateBytes: estimateGb * GIB, rssBytes: rssGb === null ? null : rssGb * GIB };
}

// One slot, a 1 GB reserve and 8 GB free unless a test says otherwise.
function input(overrides: Partial<AdmissionInput>): AdmissionInput {
  return {
    queue: [],
    held: [],
    slots: 1,
    reserveBytes: GIB,
    freeBytes: 8 * GIB,
    now: NOW,
    starvationMs: STARVATION_MS,
    ...overrides,
  };
}

describe("decideAdmission", () => {
  it("admits the oldest waiter when a slot is free and its memory fits", () => {
    expect(decideAdmission(input({ queue: [queued("a", 3)] }))).toEqual({
      admitted: [{ id: "a", forced: false }],
      blockedOn: null,
    });
  });

  it("waits on a slot while every slot is held", () => {
    expect(decideAdmission(input({ queue: [queued("a", 2)], held: [held(3, 3)] }))).toEqual({
      admitted: [],
      blockedOn: "slot",
    });
  });

  it("fills the free slots in queue order", () => {
    const queue = [queued("a", 1), queued("b", 1), queued("c", 1)];
    expect(decideAdmission(input({ queue, slots: 2, freeBytes: 16 * GIB }))).toEqual({
      admitted: [
        { id: "a", forced: false },
        { id: "b", forced: false },
      ],
      blockedOn: "slot",
    });
  });

  it("waits on memory while free memory is below the estimate plus the reserve", () => {
    const decision = decideAdmission(input({ queue: [queued("a", 3)], freeBytes: 3.5 * GIB }));
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("admits at exactly the estimate plus the reserve", () => {
    const decision = decideAdmission(input({ queue: [queued("a", 3)], freeBytes: 4 * GIB }));
    expect(decision.admitted).toEqual([{ id: "a", forced: false }]);
  });

  it("gates on slots alone when free memory is unknown", () => {
    const decision = decideAdmission(input({ queue: [queued("a", 1024)], freeBytes: null }));
    expect(decision).toEqual({ admitted: [{ id: "a", forced: false }], blockedOn: null });
  });

  it("keeps back what a running command was promised and has not used yet", () => {
    // 3 GB promised, 1 GB in use: 2 GB of the 4.5 GB free is spoken for.
    const decision = decideAdmission(
      input({ queue: [queued("a", 2)], held: [held(3, 1)], slots: 2, freeBytes: 4.5 * GIB }),
    );
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("keeps back the whole estimate of a running command whose RSS is unknown", () => {
    const decision = decideAdmission(
      input({ queue: [queued("a", 2)], held: [held(3, null)], slots: 2, freeBytes: 5.5 * GIB }),
    );
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("keeps back nothing for a running command that outgrew its estimate", () => {
    // 1 GB promised, 3 GB in use: nothing is spoken for, so the 2.5 GB free stays 2.5 GB.
    const decision = decideAdmission(
      input({ queue: [queued("a", 2)], held: [held(1, 3)], slots: 2, freeBytes: 2.5 * GIB }),
    );
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("keeps back what it promised to commands admitted in the same pass", () => {
    const queue = [queued("a", 2), queued("b", 2), queued("c", 2)];
    expect(decideAdmission(input({ queue, slots: 3, freeBytes: 6 * GIB }))).toEqual({
      admitted: [
        { id: "a", forced: false },
        { id: "b", forced: false },
      ],
      blockedOn: "memory",
    });
  });

  it("keeps FIFO order: a small command behind a blocked one waits too", () => {
    const queue = [queued("a", 3), queued("b", 0.5)];
    expect(decideAdmission(input({ queue, freeBytes: 3 * GIB }))).toEqual({
      admitted: [],
      blockedOn: "memory",
    });
  });

  it("forces the oldest waiter after the starvation time when nothing runs", () => {
    const queue = [queued("a", 3, STARVATION_MS), queued("b", 3, STARVATION_MS)];
    expect(decideAdmission(input({ queue, slots: 2, freeBytes: GIB }))).toEqual({
      admitted: [{ id: "a", forced: true }],
      blockedOn: "memory",
    });
  });

  it("does not mark a starved waiter forced when its memory fits", () => {
    const decision = decideAdmission(input({ queue: [queued("a", 3, 2 * STARVATION_MS)] }));
    expect(decision).toEqual({ admitted: [{ id: "a", forced: false }], blockedOn: null });
  });

  it("never forces while a command holds a slot", () => {
    const decision = decideAdmission(
      input({
        queue: [queued("a", 3, 2 * STARVATION_MS)],
        held: [held(1, 1)],
        slots: 2,
        freeBytes: GIB,
      }),
    );
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("decides nothing for an empty queue", () => {
    expect(decideAdmission(input({ held: [held(3, 3)] }))).toEqual({
      admitted: [],
      blockedOn: null,
    });
  });
});
