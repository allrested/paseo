import { describe, expect, it } from "vitest";
import {
  availableMemory,
  parseLoadavg,
  parseMeminfo,
  parseMeminfoFields,
  ProcTextError,
} from "./proc-text.js";

// Captured in this container on 2026-11-06. The Active(anon) and HugePages lines are added to
// show that lines with parentheses or without a unit are skipped.
const MEMINFO = [
  "MemTotal:       16042308 kB",
  "MemFree:         3529520 kB",
  "MemAvailable:    7686108 kB",
  "Buffers:         1041016 kB",
  "Cached:          2485564 kB",
  "SwapCached:       107456 kB",
  "Active:          6223316 kB",
  "Inactive:        4422876 kB",
  "Active(anon):    2048000 kB",
  "SwapTotal:      12582908 kB",
  "SwapFree:        6615772 kB",
  "HugePages_Total:       0",
  "",
].join("\n");

const MEMINFO_WITHOUT_AVAILABLE = MEMINFO.replace("MemAvailable:    7686108 kB\n", "");

describe("parseMeminfo", () => {
  it("reads total, available and swap in bytes from a real sample", () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      totalBytes: 16042308 * 1024,
      availableBytes: 7686108 * 1024,
      swapTotalBytes: 12582908 * 1024,
      swapFreeBytes: 6615772 * 1024,
    });
  });

  it("skips lines with parentheses or without a kB unit", () => {
    const fields = parseMeminfoFields(MEMINFO);
    expect(fields.has("Active(anon)")).toBe(false);
    expect(fields.has("HugePages_Total")).toBe(false);
    expect(fields.get("Active")).toBe(6223316 * 1024);
  });

  it("estimates available memory as free + buffers + cache before Linux 3.14", () => {
    expect(availableMemory(parseMeminfoFields(MEMINFO_WITHOUT_AVAILABLE))).toBe(
      (3529520 + 1041016 + 2485564) * 1024,
    );
  });

  it("names the missing line when MemTotal is absent", () => {
    expect(() => parseMeminfo("MemFree: 1 kB\n")).toThrow(
      new ProcTextError("meminfo has no MemTotal line"),
    );
  });

  it("rejects empty text, as from a host without /proc", () => {
    expect(() => parseMeminfo("")).toThrow(ProcTextError);
  });
});

describe("parseLoadavg", () => {
  it("reads the three averages from a real sample", () => {
    expect(parseLoadavg("1.54 1.88 2.22 1/10058 224556\n")).toEqual({
      load1: 1.54,
      load5: 1.88,
      load15: 2.22,
    });
  });

  it("rejects text that is not a load average", () => {
    expect(() => parseLoadavg("")).toThrow(ProcTextError);
    expect(() => parseLoadavg("1.0 abc 2.0")).toThrow(ProcTextError);
  });
});
