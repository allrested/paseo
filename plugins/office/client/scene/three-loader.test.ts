import { expect, test } from "vitest";
import { createThreeLoader, type ThreeLoaderPorts } from "./three-loader.js";
import { THREE_EXPORTS, THREE_REVISION } from "./three-types.js";

function fakeThree(): Record<string, unknown> {
  const module: Record<string, unknown> = { REVISION: THREE_REVISION, SRGBColorSpace: "srgb" };
  for (const name of THREE_EXPORTS) module[name] = function Fake() {};
  return module;
}

interface FakePorts extends ThreeLoaderPorts {
  fetches: number;
}

function ports(evaluate: () => Promise<unknown>): FakePorts {
  const fake: FakePorts = {
    fetches: 0,
    fetchBytes: async () => {
      fake.fetches += 1;
      return new Uint8Array([1]);
    },
    evaluate,
  };
  return fake;
}

test("loads once, even when two views ask at the same time", async () => {
  const loader = createThreeLoader();
  const fake = ports(async () => fakeThree());
  const states: string[] = [];
  loader.subscribe(() => states.push(loader.state().status));
  await Promise.all([loader.load(fake), loader.load(fake)]);
  await loader.load(fake);
  expect(fake.fetches).toBe(1);
  expect(states).toEqual(["loading", "ready"]);
});

test("a failed load reports its error, and a later load tries again", async () => {
  const loader = createThreeLoader();
  await loader.load(ports(() => Promise.reject(new Error("blocked by CSP"))));
  expect(loader.state()).toEqual({ status: "failed", error: "blocked by CSP" });
  await loader.load(ports(async () => fakeThree()));
  expect(loader.state().status).toBe("ready");
});

test("a module that is not three.js r170 is a failure", async () => {
  const loader = createThreeLoader();
  await loader.load(ports(async () => ({ REVISION: "171" })));
  expect(loader.state()).toEqual({ status: "failed", error: "Unexpected three.js build" });
});

test("an unsubscribed listener hears nothing", async () => {
  const loader = createThreeLoader();
  let calls = 0;
  const unsubscribe = loader.subscribe(() => {
    calls += 1;
  });
  unsubscribe();
  await loader.load(ports(async () => fakeThree()));
  expect(calls).toBe(0);
});
