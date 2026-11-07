import { describe, expect, it } from "vitest";
import type { GateStatus } from "../shared/rpc.js";
import { mergeStatus, type StatusResult } from "./status-result.js";

const GIB = 1024 ** 3;

const OLD: GateStatus = {
  state: "on",
  error: null,
  slots: 1,
  reserveBytes: GIB,
  freeBytes: 6 * GIB,
  running: [],
  waiting: [],
};

const NEW: GateStatus = { ...OLD, freeBytes: 4 * GIB };

describe("mergeStatus", () => {
  it("replaces the status and clears the error when the request succeeded", () => {
    const previous: StatusResult = { status: OLD, error: "Request timed out" };
    expect(mergeStatus(previous, { ok: true, status: NEW })).toEqual({ status: NEW, error: null });
  });

  it("takes the first status as it is", () => {
    expect(mergeStatus(undefined, { ok: true, status: NEW })).toEqual({ status: NEW, error: null });
  });

  it("keeps the last status and sets the error when the request failed", () => {
    const previous: StatusResult = { status: OLD, error: null };
    expect(mergeStatus(previous, { ok: false, error: new Error("Request timed out") })).toEqual({
      status: OLD,
      error: "Request timed out",
    });
  });

  it("has no status when the first request failed", () => {
    expect(mergeStatus(undefined, { ok: false, error: new Error("Request timed out") })).toEqual({
      status: null,
      error: "Request timed out",
    });
  });

  it("keeps having no status while the requests keep failing", () => {
    const previous: StatusResult = { status: null, error: "Request timed out" };
    expect(mergeStatus(previous, { ok: false, error: new Error("Socket closed") })).toEqual({
      status: null,
      error: "Socket closed",
    });
  });

  it("reads a thrown value that is not an Error as text", () => {
    expect(mergeStatus(undefined, { ok: false, error: "Socket closed" })).toEqual({
      status: null,
      error: "Socket closed",
    });
  });
});
