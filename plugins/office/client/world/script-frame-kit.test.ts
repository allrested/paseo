import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@getpaseo/plugin/client/ui");
});

test("an app whose kit has no ScriptFrame reads as without it, and nothing throws", async () => {
  vi.doMock("@getpaseo/plugin/client/ui", () => ({ useToast: () => ({}) }));
  const { hasScriptFrame, kitScriptFrame } = await import("./script-frame-kit.js");
  expect([hasScriptFrame(), kitScriptFrame()]).toEqual([false, null]);
});

test("an app whose kit has it offers it", async () => {
  const Fake = () => null;
  vi.doMock("@getpaseo/plugin/client/ui", () => ({ ScriptFrame: Fake }));
  const { hasScriptFrame, kitScriptFrame } = await import("./script-frame-kit.js");
  expect(hasScriptFrame()).toBe(true);
  expect(kitScriptFrame()).toBe(Fake);
});
