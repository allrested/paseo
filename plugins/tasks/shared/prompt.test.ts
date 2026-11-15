import { expect, test } from "vitest";
import { DEFAULT_PROMPT, fillPrompt } from "./prompt.js";

const TASK = {
  key: "BWLT-12",
  title: "Add the webhook",
  description: "Send it on payment.\n\nRetry three times.",
  url: "https://team.atlassian.net/browse/BWLT-12",
};

test("the default template names the task, then its description and its link", () => {
  expect(fillPrompt(DEFAULT_PROMPT, TASK)).toBe(
    [
      "Work on BWLT-12: Add the webhook",
      "",
      "Send it on payment.",
      "",
      "Retry three times.",
      "",
      "https://team.atlassian.net/browse/BWLT-12",
    ].join("\n"),
  );
});

test("a task with no description leaves no gap", () => {
  expect(fillPrompt(DEFAULT_PROMPT, { ...TASK, description: "  " })).toBe(
    "Work on BWLT-12: Add the webhook\n\nhttps://team.atlassian.net/browse/BWLT-12",
  );
});

test("a template of the user's own is filled wherever a word stands, as often as it stands", () => {
  expect(fillPrompt("Fix {key}. Read {url} first, then plan {key}.", TASK)).toBe(
    "Fix BWLT-12. Read https://team.atlassian.net/browse/BWLT-12 first, then plan BWLT-12.",
  );
});

test("the task's own text is not read for words", () => {
  expect(
    fillPrompt("{title} | {description}", { ...TASK, title: "{url}", description: "{key}" }),
  ).toBe("{url} | {key}");
});

test("a word the template does not know stays as written", () => {
  expect(fillPrompt("{key} for {team}", TASK)).toBe("BWLT-12 for {team}");
});

test("an empty template is the default one", () => {
  expect(fillPrompt(" \n ", TASK)).toBe(fillPrompt(DEFAULT_PROMPT, TASK));
});
