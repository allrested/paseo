import { describe, expect, it } from "vitest";
import {
  cdpNavigateErrorKey,
  cdpNavigateErrorStatus,
  cdpOpenErrorKey,
  withHttpForHostPort,
} from "./workspace-browser";

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

describe("cdpNavigateErrorStatus", () => {
  it("gives the view a status only for a closed tab or a missing host", () => {
    expect(cdpNavigateErrorStatus(new Error("browser_tab_not_found"))).toBe("closed");
    expect(cdpNavigateErrorStatus(new Error("browser_no_host"))).toBe("unreachable");
  });

  it("leaves a refused or timed-out address to a message", () => {
    expect(cdpNavigateErrorStatus(new Error("browser_unknown_error"))).toBeNull();
    expect(cdpNavigateErrorStatus(new Error("browser_timeout"))).toBeNull();
  });
});

describe("cdpNavigateErrorKey", () => {
  it("names the scheme only when the daemon refused the address", () => {
    expect(cdpNavigateErrorKey(new Error("browser_url_refused"))).toBe("cdpBrowser.navigateFailed");
  });

  it("gives any other failure the plain message", () => {
    expect(cdpNavigateErrorKey(new Error("browser_unknown_error"))).toBe(
      "cdpBrowser.navigateError",
    );
    expect(cdpNavigateErrorKey(new Error("browser_timeout"))).toBe("cdpBrowser.navigateError");
    expect(cdpNavigateErrorKey("boom")).toBe("cdpBrowser.navigateError");
  });
});

describe("withHttpForHostPort", () => {
  it("gives host:port input an http scheme", () => {
    expect(withHttpForHostPort("web:3000")).toBe("http://web:3000");
    expect(withHttpForHostPort(" myhost:8080/app ")).toBe("http://myhost:8080/app");
    expect(withHttpForHostPort("host.docker.internal:3000?q=1")).toBe(
      "http://host.docker.internal:3000?q=1",
    );
  });

  it("leaves a URL with a scheme and other input alone", () => {
    expect(withHttpForHostPort("https://example.com:8443/")).toBe("https://example.com:8443/");
    expect(withHttpForHostPort("about:blank")).toBe("about:blank");
    expect(withHttpForHostPort("example.com")).toBe("example.com");
  });
});
