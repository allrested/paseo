import { expect, test } from "vitest";
import type { Paseo, PaseoHolder } from "../paseo-holder.js";
import { liveCleanupPorts } from "./live-ports.js";

/** A holder whose agent handles are `handle`; a handle with `closeRuntime` is the fork's. */
function holderOf(handle: object, refs: string[] = []): PaseoHolder {
  const paseo = {
    agents: {
      ref: (id: string) => {
        refs.push(id);
        return handle;
      },
    },
  } as unknown as Paseo;
  return { remember: () => undefined, require: () => paseo, wait: async () => paseo };
}

test("a host with closeRuntime closes through the agent's handle", async () => {
  const closed: string[] = [];
  const refs: string[] = [];
  const ports = liveCleanupPorts(
    holderOf(
      {
        id: "a1",
        async closeRuntime(this: { id: string }) {
          closed.push(this.id);
        },
      },
      refs,
    ),
  );
  expect(ports.canCloseRuntime()).toBe(true);
  await ports.closeRuntime("a1");
  expect(closed).toEqual(["a1"]);
});

test("a host without closeRuntime cannot close, and says so", async () => {
  const ports = liveCleanupPorts(holderOf({ refresh: async () => null }));
  expect(ports.canCloseRuntime()).toBe(false);
  await expect(ports.closeRuntime("a1")).rejects.toThrow(
    "This host cannot close an agent's runtime",
  );
});
