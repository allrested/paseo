// @vitest-environment jsdom
// ui/session-drawer.js, the stand-in: a chosen person goes to Paseo; with opts.open, their session opens.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ sessions: new Map<string, object>([["ada", {}]]) }));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  BASE_ZOOM: 1,
  camera: { zoom: 1 },
}));
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({ focusTarget: null }));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: h.sessions,
  workers: new Map(),
}));
vi.mock("../../vendor/my-office/src/office/ui/camera-bar.js", () => ({ setView() {} }));

const { state } = await import("../../vendor/my-office/src/office/core/state.js");
const { host } = await import("../../vendor/my-office/src/office/paseo-host.js");
const { openSession } = await import("../../vendor/my-office/src/office/ui/session-drawer.js");

beforeEach(() => {
  state.selectedId = null;
  host.open = null;
  host.select = vi.fn();
});

test("opts.open asks Paseo to open the session and chooses no one", () => {
  const open = vi.fn();
  host.open = open;
  openSession("ada", { open: true });
  expect(open).toHaveBeenCalledWith("ada");
  expect(host.select).not.toHaveBeenCalled();
  expect(state.selectedId).toBeNull();
});

test("opts.open with nothing to open it falls back to choosing the person", () => {
  openSession("ada", { open: true });
  expect(host.select).toHaveBeenCalledWith("ada");
});

test("a plain call still chooses the person", () => {
  openSession("ada");
  expect(state.selectedId).toBe("ada");
  expect(host.select).toHaveBeenCalledWith("ada");
});

test("someone the scene does not know opens nothing", () => {
  const open = vi.fn();
  host.open = open;
  openSession("nobody", { open: true });
  expect(open).not.toHaveBeenCalled();
});
