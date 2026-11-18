import { expect, test } from "vitest";
import { extra } from "./host-extras.js";

test("a host with the call gives it, bound to its object", async () => {
  const ref = {
    stopped: 0,
    async cancel(this: { stopped: number }) {
      this.stopped += 1;
    },
  };
  const cancel = extra(ref, "cancel");
  await cancel?.();
  expect(ref.stopped).toBe(1);
});

test("a host without the call gives null", () => {
  expect(extra({}, "cancel")).toBeNull();
  expect(extra({ closeRuntime: "not a function" }, "closeRuntime")).toBeNull();
});
