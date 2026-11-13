import { describe, expect, it } from "vitest";
import { refusal, rewrite } from "./guard-policy.mjs";

const OURS = "wss://figcraft.dev.mtapp.dev/";
const run = (command: string, params: Record<string, unknown> = {}) =>
  refusal("run_command", { command, params }, OURS);
const JOIN_ONLY = "collab.join may only join files on figcraft.dev.mtapp.dev, by link";
const SHARING = (command: string) =>
  `${command} is not allowed here: Paseo shares design files for you`;

describe("guard policy", () => {
  it("allows ordinary design work and the live-session commands that stay in the file", () => {
    expect(run("node.create")).toBeNull();
    expect(refusal("create_node", { type: "frame" }, OURS)).toBeNull();
    for (const command of ["collab.peers", "collab.leave", "collab.stop", "collab.cursorChat"]) {
      expect(run(command)).toBeNull();
    }
  });
  it("joins our server by any of FigCraft's link forms", () => {
    for (const link of [
      "figcraft://join?host=figcraft.dev.mtapp.dev&file=a&token=b",
      "figcraft://join?host=figcraft.dev.mtapp.dev:443&file=a&token=b",
      "figcraft://join?server=wss://figcraft.dev.mtapp.dev/&file=a&token=b",
      "wss://figcraft.dev.mtapp.dev/?file=a&token=b",
    ]) {
      expect(run("collab.join", { link })).toBeNull();
      // FigCraft reads either key as either form.
      expect(run("collab.join", { code: link })).toBeNull();
    }
  });
  it("refuses joining another server, or by a join code", () => {
    for (const params of [
      { link: "figcraft://join?host=collab.craftapps.dev&file=a&token=b" },
      { link: "figcraft://join?server=wss://collab.craftapps.dev/&file=a&token=b" },
      { link: "wss://collab.craftapps.dev/?file=a&token=b" },
      { link: "figcraft://join?host=192.168.1.9:47900&file=a&token=b" },
      { code: "K7M-2QX-9TD" },
      {},
    ]) {
      expect(run("collab.join", params)).toBe(JOIN_ONLY);
    }
  });
  it("refuses sharing, publishing, hosting and managing server files", () => {
    for (const command of [
      "collab.share",
      "collab.publish",
      "collab.host",
      "collab.manageFile",
      "collab.files",
      "collab.openFile",
      "collab.forgetFile",
      "collab.recoverFile",
      "collab.removePerson",
      "collab.report",
      "collab.registerLinks",
      "collab.somethingNew",
      "library.publishToServer",
      "pref.publishServer",
    ]) {
      expect(run(command)).toBe(SHARING(command));
    }
  });
  it("keeps libraries, server info and plugin directories on our server", () => {
    const ours = "figcraft.dev.mtapp.dev";
    expect(run("library.add", { path: "design/brand.figcraft" })).toBeNull();
    expect(run("library.add", { path: "wss://figcraft.dev.mtapp.dev/?file=a&token=b" })).toBeNull();
    expect(run("library.add", { path: "wss://collab.craftapps.dev/?file=a&token=b" })).toBe(
      `library.add may only reach ${ours}`,
    );
    expect(run("collab.serverInfo", { server: "wss://figcraft.dev.mtapp.dev/" })).toBeNull();
    expect(run("collab.serverInfo", { server: "wss://collab.craftapps.dev/" })).toBe(
      `collab.serverInfo may only reach ${ours}`,
    );
    for (const command of [
      "plugin.directory.list",
      "plugin.directory.install",
      "plugin.directory.publish",
      "plugin.directory.unpublish",
    ]) {
      expect(run(command, { server: "wss://figcraft.dev.mtapp.dev/" })).toBe(SHARING(command));
    }
  });
  it("checks every command of a batch, and keeps the name out of batches", () => {
    expect(
      refusal(
        "batch",
        { commands: [{ command: "node.create" }, { command: "collab.share" }] },
        OURS,
      ),
    ).toBe(SHARING("collab.share"));
    expect(
      refusal("batch", { commands: [{ command: "pref.userName", params: { name: "You" } }] }, OURS),
    ).toBe("pref.userName is not allowed in a batch; run it on its own");
  });
});

describe("guard rewrite", () => {
  it("marks an agent's chosen name as an agent's", () => {
    expect(
      rewrite("run_command", { command: "pref.userName", params: { name: "Claude" } }),
    ).toEqual({ command: "pref.userName", params: { name: "Claude (agent)" } });
    expect(
      rewrite("run_command", { command: "pref.userName", params: { name: "Claude (agent)" } }),
    ).toBeNull();
    expect(rewrite("run_command", { command: "pref.userName", params: { name: "" } })).toEqual({
      command: "pref.userName",
      params: { name: "Agent (agent)" },
    });
  });
  it("leaves every other call as it is", () => {
    expect(rewrite("run_command", { command: "node.create", params: {} })).toBeNull();
    expect(rewrite("create_node", { type: "frame" })).toBeNull();
  });
});
