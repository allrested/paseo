import { expect, test } from "vitest";
import { failureText } from "./action-button.js";

test("plain message gets the prefix", () => {
  const text: string = failureText("Send", new Error("Paseo API is disposed"));
  expect(text).toEqual("Unable to send: Paseo API is disposed");
});

test("message that already starts with Unable to is kept", () => {
  const text: string = failureText("Post", new Error("Unable to post: the text is empty"));
  expect(text).toEqual("Unable to post: the text is empty");
});

test("an empty message leaves no colon behind", () => {
  const texts: string[] = [
    failureText("Mark done", new Error("")),
    failureText("Mark done", new Error("  ")),
  ];
  expect(texts).toEqual(["Unable to mark done", "Unable to mark done"]);
});
