import { expect, test } from "vitest";
import { THREE_EXPORTS, THREE_REVISION, isThreeModule } from "./three-types.js";

function fakeModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const module: Record<string, unknown> = { REVISION: THREE_REVISION, SRGBColorSpace: "srgb" };
  for (const name of THREE_EXPORTS) module[name] = function Fake() {};
  return { ...module, ...overrides };
}

test("accepts a module with every export the scene uses, at r170", () => {
  expect(isThreeModule(fakeModule())).toBe(true);
});

test("refuses another revision, a missing export, or no module at all", () => {
  expect(isThreeModule(fakeModule({ REVISION: "171" }))).toBe(false);
  expect(isThreeModule(fakeModule({ InstancedMesh: undefined }))).toBe(false);
  expect(isThreeModule(null)).toBe(false);
  expect(isThreeModule("three")).toBe(false);
});
