import { expect, test } from "vitest";
import { INITIAL_STREAM, streamReducer } from "./stream-state.js";

const ready = (streamId: string) => ({
  type: "ready" as const,
  streamId,
  width: 720,
  height: 1280,
});

test("ready names the stream and the device's size", () => {
  expect(streamReducer(INITIAL_STREAM, ready("s1"))).toEqual({
    streamId: "s1",
    device: { width: 720, height: 1280 },
    picture: null,
    problem: null,
  });
});

test("a picture becomes a PNG data URI, and an older seq is ignored", () => {
  let state = streamReducer(INITIAL_STREAM, ready("s1"));
  state = streamReducer(state, { type: "picture", seq: 2, png: "AAA" });
  expect(state.picture).toEqual({ seq: 2, uri: "data:image/png;base64,AAA" });

  expect(streamReducer(state, { type: "picture", seq: 1, png: "BBB" })).toBe(state);
});

test("a new ready resets the picture, the seq and the problem", () => {
  let state = streamReducer(INITIAL_STREAM, ready("s1"));
  state = streamReducer(state, { type: "picture", seq: 40, png: "OLD" });
  state = streamReducer(state, { type: "problem", message: "gone" });

  state = streamReducer(state, ready("s2"));
  expect(state).toMatchObject({ streamId: "s2", picture: null, problem: null });

  state = streamReducer(state, { type: "picture", seq: 1, png: "NEW" });
  expect(state.picture?.uri).toBe("data:image/png;base64,NEW");
});

test("a problem is kept beside what was on screen", () => {
  let state = streamReducer(INITIAL_STREAM, ready("s1"));
  state = streamReducer(state, { type: "picture", seq: 1, png: "A" });
  state = streamReducer(state, { type: "problem", message: "The Android device is unreachable" });
  expect(state.problem).toBe("The Android device is unreachable");
  expect(state.picture?.seq).toBe(1);
});
