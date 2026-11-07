import { describe, expect, it } from "vitest";
import { ProcTextError } from "../proc-text.js";
import {
  parseDf,
  parseNproc,
  parsePs,
  parseRemoteOutput,
  REMOTE_COMMAND,
  RemoteOutputError,
  splitTrailers,
  toolErrorMessage,
} from "./remote-output.js";
import { REMOTE_OUTPUT_SAMPLE, REMOTE_SNAPSHOT_SAMPLE } from "./remote-output-sample.js";

// ssh-mcp 2.x's layout for a run that failed: stdout, then "[stderr]" and its lines, then the
// exit marker, the parts joined by a blank line.
const FAILED_RUN =
  "@@meminfo\n\n\n[stderr]\ncat: /proc/meminfo: No such file or directory\n\n\n[exit 1]";

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe("REMOTE_COMMAND", () => {
  it("is the fixed read-only chain from the plan", () => {
    expect(REMOTE_COMMAND).toBe(
      "echo @@meminfo && cat /proc/meminfo && echo @@loadavg && cat /proc/loadavg && " +
        "echo @@nproc && nproc && echo @@df && df -P && echo @@ps && ps -eo pid,rss,comm",
    );
  });

  it("has no redirection, pipe, separator, variable or substitution", () => {
    expect(REMOTE_COMMAND).not.toMatch(/[\n;|<>$`]/);
    expect(REMOTE_COMMAND.replaceAll("&&", "")).not.toContain("&");
  });
});

describe("parseRemoteOutput", () => {
  it("parses the real sample", () => {
    expect(parseRemoteOutput(REMOTE_OUTPUT_SAMPLE)).toEqual(REMOTE_SNAPSHOT_SAMPLE);
  });

  it("ignores a login banner, CRLF line ends and a clean 2.x run's stderr block", () => {
    const stdout = `Welcome to db-1\r\n${REMOTE_OUTPUT_SAMPLE.replaceAll("\n", "\r\n")}`;
    const text = `${stdout}\n\n[stderr]\nwarning: setlocale: LC_ALL: cannot change locale\n`;

    expect(parseRemoteOutput(text)).toEqual(REMOTE_SNAPSHOT_SAMPLE);
  });

  it("reports a failed command with its stderr", () => {
    const error = caught(() => parseRemoteOutput(FAILED_RUN));

    expect(error).toBeInstanceOf(RemoteOutputError);
    expect(error).toHaveProperty(
      "message",
      "The command exited with code 1: cat: /proc/meminfo: No such file or directory",
    );

    const killed = caught(() =>
      parseRemoteOutput(`${REMOTE_OUTPUT_SAMPLE}\n\n[killed by SIGTERM]`),
    );

    expect(killed).toBeInstanceOf(RemoteOutputError);
    expect(killed).toHaveProperty("message", "The command was killed by SIGTERM: no message");
  });

  it("names a missing section", () => {
    const text = REMOTE_OUTPUT_SAMPLE.slice(0, REMOTE_OUTPUT_SAMPLE.indexOf("@@ps"));

    expect(() => parseRemoteOutput(text)).toThrow(
      new RemoteOutputError("The output has no ps section"),
    );
  });

  it("wraps a meminfo error with its cause", () => {
    const text = REMOTE_OUTPUT_SAMPLE.replace("MemTotal:       16042308 kB\n", "");

    const error = caught(() => parseRemoteOutput(text));

    expect(error).toBeInstanceOf(RemoteOutputError);
    expect(error).toHaveProperty("message", "meminfo has no MemTotal line");
    expect(error).toHaveProperty("cause", expect.any(ProcTextError));
  });
});

describe("splitTrailers", () => {
  it("returns stdout alone for ssh-mcp 1.x output", () => {
    expect(splitTrailers("a\nb\n")).toEqual({
      stdout: ["a", "b", ""],
      stderr: [],
      exitCode: null,
      signal: null,
    });
  });

  it("splits a failed ssh-mcp 2.x run into stdout, stderr and the exit code", () => {
    expect(splitTrailers("a\n\n\n[stderr]\nwarn\n\n\n[exit 2]")).toEqual({
      stdout: ["a", "", ""],
      stderr: ["warn", "", ""],
      exitCode: 2,
      signal: null,
    });
  });
});

describe("toolErrorMessage", () => {
  it("shows a failed 2.x run's exit code and stderr, not the readings before it", () => {
    const readings = REMOTE_OUTPUT_SAMPLE.slice(0, REMOTE_OUTPUT_SAMPLE.indexOf("@@ps") + 5);
    const text = `${readings}\n\n[stderr]\nsh: 1: ps: not found\n\n\n[exit 127]`;

    expect(toolErrorMessage(text)).toBe("The command exited with code 127: sh: 1: ps: not found");
  });

  it("names the signal of a command ssh-mcp 2.x killed", () => {
    expect(toolErrorMessage("@@meminfo\n\n[killed by SIGKILL]")).toBe(
      "The command was killed by SIGKILL: no message",
    );
  });

  it("passes ssh-mcp's own message through, trimmed", () => {
    const refused = "Error (code 255): ssh: connect to host db-1 port 22: Connection refused";

    expect(toolErrorMessage(`\n${refused}\n`)).toBe(refused);
    expect(toolErrorMessage("  ")).toBe("ssh-mcp reported an error without a message");
  });
});

describe("parseNproc", () => {
  it("reads a positive count and rejects anything else", () => {
    expect(parseNproc(["", "8"])).toBe(8);
    expect(() => parseNproc(["nproc: not found"])).toThrow(
      new RemoteOutputError("Unrecognised nproc output: nproc: not found"),
    );
    expect(() => parseNproc(["0"])).toThrow(RemoteOutputError);
  });
});

describe("parseDf", () => {
  it("scales by the header's block size, keeps spaces in mount points, skips tmpfs", () => {
    expect(
      parseDf([
        "Filesystem 512-blocks Used Available Capacity Mounted on",
        "/dev/sdb1 2000 500 1500 25% /mnt/My Disk",
        "/dev/sdc1 1000 - - - /mnt/odd",
        "tmpfs 100 0 100 0% /run",
        "none 0 0 0 - /sys/fs/bpf",
      ]),
    ).toEqual([
      {
        mount: "/mnt/My Disk",
        totalBytes: 2000 * 512,
        usedBytes: 500 * 512,
        availableBytes: 1500 * 512,
      },
    ]);
    expect(
      parseDf([
        "Dateisystem 1024-Blöcke Benutzt Verfügbar Kapazität Eingehängt auf",
        "/dev/sda1 4 1 3 25% /",
      ]),
    ).toEqual([{ mount: "/", totalBytes: 4096, usedBytes: 1024, availableBytes: 3072 }]);
    expect(
      parseDf([
        "Sys. de fichiers 1024-blocs Utilisé Disponible Capacité Monté sur",
        "/dev/sda1 4 1 3 25% /",
      ]),
    ).toEqual([{ mount: "/", totalBytes: 4096, usedBytes: 1024, availableBytes: 3072 }]);
  });

  it("rejects an unrecognised header", () => {
    expect(() => parseDf(["Filesystem Size Used Avail Use% Mounted on"])).toThrow(
      new RemoteOutputError("Unrecognised df header: Filesystem Size Used Avail Use% Mounted on"),
    );
  });
});

describe("parsePs", () => {
  it("keeps the 10 largest by RSS, ties by pid, and skips rows it cannot read", () => {
    const rows = Array.from({ length: 12 }, (_, index) => `${100 + index} 2048 worker`);
    const processes = parsePs(["  PID   RSS COMMAND", ...rows, "  x y z", "  7  4096 big one"]);

    expect(processes).toHaveLength(10);
    expect(processes[0]).toEqual({ pid: 7, rssBytes: 4096 * 1024, command: "big one" });
    expect(processes.slice(1).map((entry) => entry.pid)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108,
    ]);
  });

  it("rejects output without the ps header", () => {
    expect(() => parsePs(["ps: unknown option -- o"])).toThrow(RemoteOutputError);
  });
});
