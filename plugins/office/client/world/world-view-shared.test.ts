import { expect, test, vi } from "vitest";
import type { OfficeModel } from "../../shared/model.js";
import { worldStartOptions, type WorldLatest } from "./world-view-shared.js";

vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => async () => ({}) }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ useToast: () => ({ error: () => undefined }) }));

const MODEL: OfficeModel = {
  rooms: [],
  attention: [],
  agentTasks: [],
  agents: new Map(),
  roomOfAgent: new Map(),
  waitingOn: new Map(),
};

function latest(overrides: Partial<WorldLatest> = {}): { current: WorldLatest } {
  return {
    current: {
      model: MODEL,
      theme: { colors: new Proxy({}, { get: () => "#808080" }) } as never,
      focusRoomId: null,
      selectedAgentId: null,
      onSelectAgent: vi.fn(),
      onSelectBoard: vi.fn(),
      onOpenMachine: vi.fn(),
      onOpenResources: undefined,
      onOpenSession: undefined,
      onOpenLibrary: vi.fn(),
      onOpenNotes: vi.fn(),
      onOpenIncidents: vi.fn(),
      onBell: vi.fn(),
      onProblem: vi.fn(),
      ...overrides,
    },
  };
}

const BRAND = { name: "Paseo", logoUrl: null };

test("a person chosen takes the keyboard; a card closed leaves it", () => {
  const focus = vi.fn();
  const now = latest();
  const options = worldStartOptions(now, { focus, brand: BRAND });
  options.onSelect(null);
  expect(focus).not.toHaveBeenCalled();
  options.onSelect("a1");
  expect(focus).toHaveBeenCalledTimes(1);
  expect(now.current.onSelectAgent).toHaveBeenNthCalledWith(1, null);
  expect(now.current.onSelectAgent).toHaveBeenNthCalledWith(2, "a1");
});

test("the bell opens nothing of Paseo's, so the keyboard stays in the office", () => {
  const focus = vi.fn();
  const now = latest();
  worldStartOptions(now, { focus, brand: BRAND }).onBell?.();
  expect(now.current.onBell).toHaveBeenCalledTimes(1);
  expect(focus).not.toHaveBeenCalled();
});

test("onOpen and onResources are given only where Paseo can open them", () => {
  const without = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND });
  expect("onOpen" in without).toBe(false);
  expect("onResources" in without).toBe(false);
  const openSession = vi.fn();
  const openResources = vi.fn();
  const focus = vi.fn();
  const now = latest({ onOpenSession: openSession, onOpenResources: openResources });
  const given = worldStartOptions(now, { focus, brand: BRAND });
  given.onOpen?.("a1");
  given.onResources?.();
  expect(openSession).toHaveBeenCalledWith("a1");
  expect(openResources).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalledTimes(2);
});

test("the plan, the brand and the colours are the scene's start", () => {
  const options = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND });
  expect({ plan: options.plan, brand: options.brand, dark: typeof options.dark }).toEqual({
    plan: "pro",
    brand: BRAND,
    dark: "boolean",
  });
});

test("photo is passed through only when the caller says it", () => {
  const web = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND });
  const native = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND, photo: false });
  expect([web.photo, native.photo]).toEqual([undefined, false]);
});

test("a problem the scene reports goes to the latest handler", () => {
  const now = latest();
  const options = worldStartOptions(now, { focus: vi.fn(), brand: BRAND });
  const later = vi.fn();
  now.current = { ...now.current, onProblem: later };
  options.onProblem("the graphics context was lost");
  expect(later).toHaveBeenCalledWith("the graphics context was lost");
});
