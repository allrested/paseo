import { expect, test } from "vitest";
import { createWorldLoader } from "./world-loader.js";

function counted(answer: () => Promise<string>): { fetch(): Promise<string>; calls: number } {
  const fake = {
    calls: 0,
    fetch: () => {
      fake.calls += 1;
      return answer();
    },
  };
  return fake;
}

test("loads once, even when two views ask at the same time", async () => {
  const loader = createWorldLoader();
  const host = counted(async () => "globalThis.PaseoOfficeWorld = {};");
  const states: string[] = [];
  loader.subscribe(() => states.push(loader.state().status));
  await Promise.all([loader.load(host.fetch), loader.load(host.fetch)]);
  await loader.load(host.fetch);
  expect(host.calls).toBe(1);
  expect(states).toEqual(["loading", "ready"]);
  expect(loader.state()).toEqual({ status: "ready", script: "globalThis.PaseoOfficeWorld = {};" });
});

test("a failed load reports its error, and a later load tries again", async () => {
  const loader = createWorldLoader();
  await loader.load(() => Promise.reject(new Error("The host did not answer")));
  expect(loader.state()).toEqual({
    status: "failed",
    error: "The host did not answer",
  });
  await loader.load(async () => "script");
  expect(loader.state().status).toBe("ready");
});

test("an empty build is a failure", async () => {
  const loader = createWorldLoader();
  await loader.load(async () => "  \n");
  expect(loader.state()).toEqual({
    status: "failed",
    error: "The host sent an empty office build",
  });
});

test("an unsubscribed listener hears nothing", async () => {
  const loader = createWorldLoader();
  let calls = 0;
  const unsubscribe = loader.subscribe(() => {
    calls += 1;
  });
  unsubscribe();
  await loader.load(async () => "script");
  expect(calls).toBe(0);
});
