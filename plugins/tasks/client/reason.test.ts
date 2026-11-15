import { expect, test } from "vitest";
import { reason } from "./reason.js";

test("keeps the handler's sentence and drops what the daemon and the client wrap it in", () => {
  const error = new Error(
    "Request failed: Jira rejected the saved sign-in details. requestType=plugin.rpc.invoke.request code=handler_error",
  );
  expect(reason(error)).toBe("Jira rejected the saved sign-in details.");
});

test("leaves any other message as it is", () => {
  expect(reason(new Error("The host is not connected"))).toBe("The host is not connected");
  expect(reason(new Error("Timed out requestType=plugin.rpc.invoke.request"))).toBe("Timed out");
  expect(reason("plain")).toBe("plain");
});
