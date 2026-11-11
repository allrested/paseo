import { expect, test } from "vitest";
import { keptSelection } from "./office-surface.js";

function agents(...ids: string[]): ReadonlyMap<string, unknown> {
  return new Map(ids.map((id): [string, unknown] => [id, { id }]));
}

test("a selected agent still in the model is kept", () => {
  const kept: string | null = keptSelection("a1", agents("a1", "a2"), true);
  expect(kept).toEqual("a1");
});

test("a selected agent that left the model is dropped", () => {
  const kept: string | null = keptSelection("a1", agents("a2"), true);
  expect(kept).toEqual(null);
});

test("the selection is dropped when the subscription is not live", () => {
  const kept: string | null = keptSelection("a1", agents("a1"), false);
  expect(kept).toEqual(null);
});

test("no selection stays none", () => {
  const kept: string | null = keptSelection(null, agents("a1"), true);
  expect(kept).toEqual(null);
});
