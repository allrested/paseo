import { describe, expect, test } from "vitest";
import type { StackReading } from "../shared/stack.js";
import { androidSummary, deploySummary, figcraftSummary, paseoSummary } from "./stack-cards.js";

const UP = { ok: true, ms: 12, error: null };

function reading(overrides: Partial<StackReading> = {}): StackReading {
  return {
    readAt: "2026-11-14T06:00:00.000Z",
    paseo: { version: "0.16.0-beta.5", uptimeSeconds: 7200 },
    figcraft: { status: "on", server: UP, web: UP, cliVersion: "0.18.1", keyFile: "present" },
    android: { status: "on", state: "device", androidVersion: "14", maestro: true, error: null },
    deploy: {
      status: "on",
      repo: "allrested/paseo",
      tag: "v0.16.0-beta.5",
      runAt: "2026-11-13T21:27:12Z",
      docker: "success",
      deployJob: "success",
      error: null,
    },
    ...overrides,
  };
}

describe("Stack cards", () => {
  test("all well: every card is OK with its plain readings", () => {
    const all = reading();
    expect(paseoSummary(all)).toMatchObject({ status: "ok", label: "OK", note: null });
    expect(paseoSummary(all).meters.map((m) => m.value)).toEqual(["0.16.0-beta.5", "2 h 0 min"]);
    expect(figcraftSummary(all).meters.map((m) => m.value)).toEqual([
      "Up · 12 ms",
      "Up · 12 ms",
      "Present",
    ]);
    expect(androidSummary(all).status).toBe("ok");
    expect(deploySummary(all)).toMatchObject({ status: "ok", note: null });
    expect(deploySummary(all).meters.map((m) => m.value)).toEqual([
      "v0.16.0-beta.5",
      "Passed",
      "Passed",
    ]);
  });

  test("a part that is not set up here is Off and says which setting", () => {
    const none = reading({
      figcraft: { status: "off" },
      android: { status: "off" },
      deploy: { status: "off" },
    });
    expect(figcraftSummary(none)).toEqual({
      status: "waiting",
      label: "Off",
      note: "Set FIGCRAFT_URL on this host to check FigCraft",
      meters: [],
    });
    expect(androidSummary(none).note).toBe(
      "Set PASEO_ANDROID_ADB on this host to check the device",
    );
    expect(deploySummary(none).note).toBe(
      "Set PASEO_DEPLOY_REPO on this host to follow its releases",
    );
    expect(paseoSummary(none).status).toBe("ok");
  });

  test("Paseo warns when the newest tag is not what this instance runs", () => {
    const behind = reading({ paseo: { version: "0.16.0-beta.4", uptimeSeconds: 1 } });
    expect(paseoSummary(behind)).toMatchObject({
      status: "warning",
      note: "The newest tag is v0.16.0-beta.5; this instance runs 0.16.0-beta.4",
    });
  });

  test("FigCraft: a silent server is critical; the web app or the key file is a warning", () => {
    const down = { ok: false, ms: null, error: "connect ECONNREFUSED" };
    expect(figcraftSummary(reading({ figcraft: { ...onFig(), server: down } }))).toMatchObject({
      status: "critical",
      note: "The FigCraft server does not answer: connect ECONNREFUSED",
    });
    expect(figcraftSummary(reading({ figcraft: { ...onFig(), web: down } })).status).toBe(
      "warning",
    );
    expect(
      figcraftSummary(reading({ figcraft: { ...onFig(), keyFile: "missing" } })),
    ).toMatchObject({
      status: "warning",
      note: "The server key file is missing: design mode is off",
    });
  });

  test("Android: no answer or not a device is critical; no maestro is a warning", () => {
    const on = {
      status: "on" as const,
      state: "device",
      androidVersion: "14",
      maestro: true,
      error: null,
    };
    expect(
      androidSummary(reading({ android: { ...on, error: "device offline", state: null } })).status,
    ).toBe("critical");
    expect(androidSummary(reading({ android: { ...on, state: "offline" } })).note).toBe(
      "The device is offline",
    );
    expect(androidSummary(reading({ android: { ...on, maestro: false } })).status).toBe("warning");
  });

  test("Deploy: a failed job is critical, a running one a warning, an unreadable one an error", () => {
    const base = reading().deploy;
    if (base.status !== "on") throw new Error("deploy on");
    expect(deploySummary(reading({ deploy: { ...base, deployJob: "failure" } }))).toMatchObject({
      status: "critical",
      note: "The v0.16.0-beta.5 release did not finish",
    });
    // While the images build, the run has no deploy job yet: that is not a skipped deploy.
    const building = deploySummary(
      reading({ deploy: { ...base, docker: "in_progress", deployJob: null } }),
    );
    expect(building).toMatchObject({
      status: "warning",
      label: "Running",
      note: "The v0.16.0-beta.5 release is still running",
    });
    expect(building.meters.map((m) => m.value)).toEqual([
      "v0.16.0-beta.5",
      "Running",
      "Not started",
    ]);
    expect(
      deploySummary(reading({ deploy: { ...base, deployJob: null } })).meters.at(-1)?.value,
    ).toBe("Skipped");
    expect(deploySummary(reading({ deploy: { ...base, error: "gh is not on PATH" } }))).toEqual({
      status: "error",
      label: "Error",
      note: "gh is not on PATH",
      meters: [],
    });
  });
});

function onFig() {
  const figcraft = reading().figcraft;
  if (figcraft.status !== "on") throw new Error("figcraft on");
  return figcraft;
}
