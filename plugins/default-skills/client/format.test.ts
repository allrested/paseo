import { describe, expect, it } from "vitest";
import type { SyncStatus } from "../shared/rpc.js";
import { describeSkill } from "./format.js";

function done(folders: Extract<SyncStatus, { status: "done" }>["skills"][number]["folders"]) {
  const status: SyncStatus = {
    status: "done",
    skillsDirectory: "/home/u/.claude/skills",
    skills: [{ id: "anti-slop", folders }],
    recordError: null,
  };
  return status;
}

describe("describeSkill", () => {
  it("names the skills folder when every folder is installed", () => {
    expect(describeSkill(done([{ folder: "antislop", state: "installed" }]), "anti-slop")).toEqual({
      state: "Installed in /home/u/.claude/skills",
      error: null,
    });
  });

  it("says Off when the switch removed every folder", () => {
    expect(describeSkill(done([{ folder: "antislop", state: "off" }]), "anti-slop").state).toBe(
      "Off",
    );
  });

  it("lists a skipped folder with its reason and a failed one as the error", () => {
    expect(
      describeSkill(
        done([
          { folder: "antislop", state: "installed" },
          { folder: "antislop-ui", state: "skipped", reason: "a folder with this name exists" },
          { folder: "antislop-code", state: "error", error: "EACCES" },
        ]),
        "anti-slop",
      ),
    ).toEqual({
      state: "Installed: antislop. Skipped antislop-ui: a folder with this name exists",
      error: "antislop-code: EACCES",
    });
  });

  it("shows a failed sync as the error", () => {
    expect(describeSkill({ status: "failed", error: "record is not valid" }, "anti-slop")).toEqual({
      state: "Not synced",
      error: "record is not valid",
    });
  });
});
