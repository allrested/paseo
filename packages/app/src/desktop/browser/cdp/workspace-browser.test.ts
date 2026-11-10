import { describe, expect, it } from "vitest";
import { cdpOpenErrorKey } from "./workspace-browser";

describe("cdpOpenErrorKey", () => {
  it("maps a missing or unsupported host to the unreachable title", () => {
    expect(cdpOpenErrorKey(new Error("browser_no_host"))).toBe("cdpBrowser.unreachable.title");
    expect(cdpOpenErrorKey(new Error("browser_unsupported"))).toBe("cdpBrowser.unreachable.title");
  });

  it("maps any other failure to the open-failed string, never the raw code", () => {
    expect(cdpOpenErrorKey(new Error("browser_open_failed"))).toBe("cdpBrowser.openFailed");
    expect(cdpOpenErrorKey("boom")).toBe("cdpBrowser.openFailed");
  });
});
