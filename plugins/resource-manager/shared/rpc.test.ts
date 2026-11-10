import { describe, expect, it } from "vitest";
import {
  closeAgentRpc,
  GroupKindSchema,
  isClosableStatus,
  localRpc,
  LocalReadingSchema,
  serverRpc,
  ServerReadingSchema,
  serversRpc,
  type HostSummary,
  type LocalReading,
} from "./rpc.js";

const HOST: HostSummary = {
  memoryUsedBytes: 3 * 1024 ** 3,
  memoryLimitBytes: null,
  swapUsedBytes: 0,
  swapTotalBytes: 0,
  hostAvailableBytes: 7 * 1024 ** 3,
  hostTotalBytes: 16 * 1024 ** 3,
  load1: 1.54,
  load5: 1.88,
  load15: 2.22,
  cores: 2,
};

const READING: LocalReading = {
  readAt: "2026-11-06T09:00:00.000Z",
  host: HOST,
  agents: [],
  groups: [],
  agentsError: null,
};

describe("resource-manager RPC contracts", () => {
  it("uses the RPC names from the spec", () => {
    expect([localRpc.name, serversRpc.name, serverRpc.name, closeAgentRpc.name]).toEqual([
      "resource-manager.local.request",
      "resource-manager.servers.request",
      "resource-manager.server.request",
      "resource-manager.close_agent.request",
    ]);
  });

  it("lists the four groups in display order", () => {
    expect(GroupKindSchema.options).toEqual(["daemon", "sharedMcp", "heavyGate", "other"]);
  });

  it("lets only idle agents be closed", () => {
    const statuses = ["initializing", "idle", "running", "error", "closed"];
    expect(statuses.map((status) => isClosableStatus(status))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it("accepts a reading with a positive core count and rejects zero cores", () => {
    expect(LocalReadingSchema.safeParse(READING).success).toBe(true);
    const zeroCores: LocalReading = { ...READING, host: { ...HOST, cores: 0 } };
    expect(LocalReadingSchema.safeParse(zeroCores).success).toBe(false);
  });

  it("accepts a server reading with and without per-host readings", () => {
    const reading = { id: "0123456789abcdef", snapshot: null, readAt: null, error: null };
    const host = {
      profile: "prod",
      label: "deploy@10.0.0.1:22",
      snapshot: null,
      readAt: null,
      error: "Connection refused",
    };

    expect(ServerReadingSchema.parse(reading)).toStrictEqual(reading);
    expect(ServerReadingSchema.parse({ ...reading, hosts: [host] })).toStrictEqual({
      ...reading,
      hosts: [host],
    });
  });

  it("refuses an empty server id and an empty agent id", () => {
    expect(serverRpc.input.safeParse({ id: "" }).success).toBe(false);
    expect(serverRpc.input.safeParse({ id: "0123456789abcdef" }).success).toBe(true);
    expect(closeAgentRpc.input.safeParse({ agentId: "" }).success).toBe(false);
    expect(closeAgentRpc.input.safeParse({ agentId: "agent-1" }).success).toBe(true);
  });
});
