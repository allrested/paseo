import { describe, expect, it } from "vitest";
import { MIN_WORKSPACE_BODY_WIDTH } from "@/components/explorer-sidebar-layout";
import { clampBesideWidth } from "./beside-layout";

describe("clampBesideWidth", () => {
  it("starts at the Explorer's default width", () => {
    expect(clampBesideWidth(null, 1280)).toBe(320);
  });

  it("never goes below 240", () => {
    expect(clampBesideWidth(100, 1280)).toBe(240);
  });

  it("leaves the plugin's content the workspace body's minimum of the container's width", () => {
    const containerWidth = 900;
    expect(clampBesideWidth(2000, containerWidth)).toBe(containerWidth - MIN_WORKSPACE_BODY_WIDTH);
  });

  it("keeps a width that fits", () => {
    expect(clampBesideWidth(480, 1280)).toBe(480);
  });
});
